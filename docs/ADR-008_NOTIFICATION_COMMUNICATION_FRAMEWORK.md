# ARCHITECTURE DECISION RECORD (ADR-008)
## NOTIFICATION & COMMUNICATION FRAMEWORK

**Estado:** APROBADO  
**Contexto:** Arquitectura de Comunicaciones Omnicanal y Mensajería Transaccional Enterprise  
**Arquitecto:** Principal Solutions Architect (Especialista en SES, SNS, FCM & Notification Systems)  
**Versión:** 1.0.0  

---

## CAPÍTULO 1: Filosofía del Framework

### ¿Por qué centralizar toda la comunicación?
En una plataforma serverless empresarial como CommerceOS, permitir que múltiples microservicios (como Catálogo, Carrito u Órdenes) se conecten y envíen correos electrónicos o mensajes SMS de forma independiente genera graves problemas arquitectónicos:
1. **Acoplamiento de Proveedores**: Si el microservicio de órdenes invoca directamente a Twilio o SendGrid, cambiar de proveedor de SMS o correo obligaría a modificar, probar y redesplegar el código de órdenes, infringiendo el principio de responsabilidad única.
2. **Inconsistencia de Plantillas**: Las plantillas de correo acabarían dispersas en los repositorios de cada microservicio, haciendo imposible realizar actualizaciones globales de diseño (branding, cabeceras, pie de página) de forma homogénea.
3. **Ausencia de Control de Preferencias**: Sería sumamente complejo forzar políticas de exclusión voluntaria (*Opt-out*) o límites de frecuencia de envíos si no hay un punto central que audite cada salida hacia el cliente.

### ¿Por qué utilizar Event-Driven Communication?
Adoptamos una filosofía 100% asíncrona basada en eventos: los servicios transaccionales emiten eventos genéricos (ej: `ORDER_PAID`) al bus de EventBridge (ADR-004) sin saber si eso disparará un email, un SMS o un mensaje de WhatsApp. El Notification Hub intercepta estos eventos en segundo plano, aplica las reglas de negocio y procesa la entrega sin añadir latencia al flujo de compra del usuario.

### Beneficios del Enfoque Centralizado:
- **Trazabilidad Forense Completa**: Cada intento de envío se registra bajo el mismo `traceId` y `correlationId` que inició el evento en la interfaz del cliente.
- **Auditoría Legal**: Registro centralizado e inmutable de comunicaciones (útil para cumplimiento normativo como GDPR o CCPA).
- **Escalabilidad y Tolerancia a Fallos**: Si un proveedor de correos (ej. SES) experimenta una degradación temporal, las colas SQS retienen los mensajes y aplican políticas de reintentos exponencialmente sin pérdida de información.

---

## CAPÍTULO 2: Arquitectura General del Communication Hub

El flujo de enrutamiento y despacho de comunicaciones de CommerceOS sigue la siguiente topología Serverless:

```
[Origen del Evento]
       │
       ▼ (Publica Evento de Dominio)
[EventBridge Custom Bus]
       │
       ▼ (Regla EventBridge)
[SQS Notification Queues] (Segregación por Prioridad: Alta, Media, Baja)
       │
       ▼ (Consumo en Batch)
[Notification Hub Orchestrator Lambda]
       │
       ├──> [Rules Engine] (Valida Preferencias del Usuario, Opt-in/Opt-out, Silent Hours)
       ├──> [Template Engine] (Inyecta variables dinámicas, Idioma e i18n)
       └──> [Channel Resolver] (Determina los canales activos: Email, WhatsApp, Push)
       │
       ▼ (Despacho en Paralelo)
[Provider Manager Abstraction]
       │
       ├──> [SES Service] ─────> Email Delivery
       ├──> [Twilio Service] ──> SMS Delivery
       └──> [FCM Service] ─────> Mobile Push
       │
       ▼ (CDC Logs de Entregas)
[DynamoDB Tracking Table] ──> [Analytics Dashboard]
```

### Componentes y Responsabilidades:
1. **SQS Notification Queues**: Amortiguan picos de tráfico y dividen las notificaciones en colas prioritarias (ej. colas rápidas para OTP/Reset Password y colas lentas para boletines promocionales).
2. **Rules Engine**: Evalúa el perfil y las preferencias del usuario receptor (idioma, canales silenciados, zona horaria) antes de autorizar el envío.
3. **Template Engine**: Compila y fusiona los layouts maestros (diseños HTML/Markdown corporativos) con los datos variables específicos del payload.
4. **Channel Resolver**: Resuelve a través de qué canales debe despacharse el mensaje según las reglas del evento (ej: un OTP va por SMS y Email; una confirmación de orden por Email y WhatsApp).
5. **Provider Manager Abstraction**: Capa de aislamiento que traduce el mensaje unificado al API específico del proveedor seleccionado (SES, Twilio, Firebase).

---

## CAPÍTULO 3: Omnicanalidad y Extensibilidad de Canales

El framework está diseñado bajo principios de diseño SOLID (abierto/cerrado) para permitir agregar nuevos proveedores de comunicación mediante adaptadores de interfaz (*Channel Adaptors*):

- **Email (Amazon SES)**: Despacho de correos HTML responsivos y texto plano con soporte DKIM y SPF.
- **SMS (Amazon SNS / Twilio)**: Mensajería de texto corta y directa para alertas inmediatas.
- **Push & Web Push (Firebase Cloud Messaging - FCM / APNs)**: Alertas directas a aplicaciones móviles (iOS/Android) y navegadores web de escritorio.
- **Telegram (Telegram Bot API)**: Canal alternativo gratuito y rápido para alertas administrativas del equipo y usuarios finales que activen su bot.
- **WhatsApp (WhatsApp Business API via Twilio/Meta)**: Canal de alta tasa de apertura para resúmenes de compra y notificaciones conversacionales.
- **In-App (Notification Center Table)**: Registro de notificaciones internas expuestas en el panel del usuario de CommerceOS.
- **Webhooks & Chat Integrations (Slack / Microsoft Teams)**: Envío de payloads estructurados para alertas de negocio del equipo interno (ej: alertas de bajo inventario o fallos en procesamiento de DAM).

---

## CAPÍTULO 4: Template Engine y Gestión de Plantillas

Las comunicaciones corporativas exigen un control estricto de su diseño visual. Diseñamos un motor de plantillas centralizado:

- **Formato Multicapa**: Soporte nativo para HTML responsivo (diseños limpios y tabulares para emails), Markdown (para chats y notificaciones en Slack) y Texto Plano (para SMS).
- **Layouts y Fragmentos Reutilizables**: Estructura de cabeceras, pie de página, avisos legales y políticas de privacidad definidos en un archivo base, evitando que los desarrolladores los repitan en cada plantilla.
- **Internacionalización (i18n)**: Mapeo de traducciones por clave-valor. Si el idioma del usuario es `en`, el motor compila la versión en inglés de la plantilla utilizando los mismos datos de origen.
- **Ciclo de Vida de Plantillas**:
  - `DRAFT`: Edición activa de diseño.
  - `PUBLISHED`: Plantilla aprobada y activa para despachos masivos.
  - `ARCHIVED`: Desactivada para nuevos envíos históricos.
- **Versionado Semántico**: Cada plantilla se guarda con número de versión (`1.0.0`, `1.1.0`). Los eventos pueden solicitar explícitamente una versión de plantilla o consumir por defecto la última versión publicada.

---

## CAPÍTULO 5: Catálogo de Eventos Desencadenantes de Comunicaciones

Todas las comunicaciones se desencadenan reaccionando a los siguientes eventos de dominio del bus:

### 1. **`IDENTITY.USER_REGISTERED`**
- *Publisher*: `Identity Service`
- *Consumidor*: `Notification Hub` (Prioridad: Alta)
- *Payload*: `{ "userId": "usr_111", "email": "user@example.com", "name": "Juan Perez" }`
- *Canales*: Email (Activación de Cuenta).

### 2. **`COMMERCE.ORDER_PAID`**
- *Publisher*: `Checkout / Order Service`
- *Consumidor*: `Notification Hub` (Prioridad: Alta)
- *Payload*: `{ "orderId": "ord_555", "amount": 99.99, "items": [...] }`
- *Canales*: Email, WhatsApp (Confirmación y Factura).

### 3. **`INVENTORY.LOW_STOCK_DETECTED`**
- *Publisher*: `Inventory Service`
- *Consumidor*: `Notification Hub` (Prioridad: Baja)
- *Payload*: `{ "sku": "SHO-RED-42", "currentStock": 3, "minThreshold": 5 }`
- *Canales*: Slack (Alerta al canal de compras administrativas).

### 4. **`DAM.MEDIA_PROCESSING_FAILED`**
- *Publisher*: `DAM Engine`
- *Consumidor*: `Notification Hub` (Prioridad: Media)
- *Payload*: `{ "mediaId": "med_888", "error": "Codec unsupported" }`
- *Canales*: In-App, Email (Alertar al operador que subió el archivo).

---

## CAPÍTULO 6: Preferencias de Usuario y Consentimientos

El Rules Engine valida la base de datos de consentimientos de usuario antes de proceder con cualquier envío (cumplimiento regulatorio global):

- **Políticas de Suscripción (Opt-in / Opt-out)**:
  - *Comunicaciones Transaccionales* (ej. códigos OTP, confirmaciones de pago): Son obligatorias y no permiten Opt-out.
  - *Comunicaciones Promocionales* (ej. ofertas, boletines): Requieren consentimiento explícito (*Opt-in*) y deben incluir una cabecera de desuscripción inmediata (`List-Unsubscribe` en emails).
- **Frecuencia y Silenciado (Silent Hours)**:
  - Posibilidad de silenciar alertas no urgentes entre las 22:00 y las 07:00 en la zona horaria registrada del usuario.
  - Agrupación por frecuencia (ej: "Deseo recibir resúmenes semanales de ofertas en lugar de correos diarios").

---

## CAPÍTULO 7: Planificación, Envíos y Rate Limiting

- **Envíos Diferidos (Scheduled Deliveries)**: Registro de tareas programadas utilizando temporizadores (ADR-004) para notificaciones de recordatorios (ej. recordar al cliente un carrito abandonado después de 4 horas).
- **Ventanas Horarias**: Restricción de envío de SMS y WhatsApp promocionales a horarios comercialmente aceptables (definidos por regulaciones locales).
- **Rate Limiting por Destinatario**: Bloqueo dinámico para evitar abusos o spam (ej: no permitir enviar más de 3 correos de restablecimiento de contraseña a la misma dirección de email en menos de 10 minutos).

---

## CAPÍTULO 8: Abstracción de Proveedores y Evitación de Vendor Lock-in

Toda llamada externa se realiza a través de interfaces genéricas. El código del orquestador no conoce detalles de la API de Amazon o Twilio.

```
                  ┌───────────────┐
                  │    Channel    │ (Definición de Interfaz)
                  │    Adaptor    │
                  └───────┬───────┘
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
  │   Adapter   │  │   Adapter   │  │   Adapter   │ (Implementación)
  │ Amazon SES  │  │   Twilio    │  │Firebase FCM │
  └─────────────┘  └─────────────┘  └─────────────┘
```

- **Resiliencia ante Caídas (Circuit Breaker)**: Si el adaptador activo (ej. Twilio) retorna errores de red consecutivos en el envío de SMS, el framework desvía automáticamente las peticiones hacia un proveedor secundario configurado (ej. MessageBird) sin interrumpir la operación del negocio.

---

## CAPÍTULO 9: Tracking del Ciclo de Vida de Mensajes

Cada notificación emitida se registra en una tabla dedicada (`commerceos-communications-tracking`) con estados granulares del ciclo de vida del mensaje:

- **`SENT`**: El mensaje fue despachado exitosamente hacia el proveedor externo.
- **`DELIVERED`**: El proveedor externo confirmó la entrega física en el dispositivo.
- **`OPENED`**: El destinatario abrió el mensaje (rastreado mediante píxel transparente de tracking o APIs de canal).
- **`CLICKED`**: El destinatario hizo clic en algún enlace interno (URLs convertidas a punteros del redireccionador de tracking).
- **`BOUNCED`**: El mensaje rebotó (dirección inválida o buzón lleno).
- **`SPAM`**: El destinatario reportó el mensaje como correo no deseado.
- **`FAILED`**: Fallo de entrega interna o rechazo de API por parte del proveedor.

---

## CAPÍTULO 10: Dashboards y Analytics de Comunicación

Alimentamos visualizaciones gerenciales y operativas a través del CDC del Tracking:

- **Métricas de Rendimiento**: Tasa de apertura (*Open Rate*), tasa de clicks (*CTR*) y tasa de rebotes (*Bounce Rate*).
- **Monitoreo de Reputación**: Tasa de quejas por spam (debe mantenerse por debajo del `0.1%` para evitar que Amazon SES suspenda la cuenta de envío).
- **Latencia de Despacho**: Tiempo promedio transcurrido entre el disparo del evento de dominio original y el recibo del mensaje en el destino final.

---

## CAPÍTULO 11: Seguridad y Mitigación de Abuso

- **Protección contra Spoofing**: Configuración obligatoria de firmas DKIM (DomainKeys Identified Mail), políticas SPF (Sender Policy Framework) y DMARC sobre los dominios de CommerceOS.
- **Validación de Webhooks Entrantes**: Las respuestas de apertura y rebotes enviadas por proveedores externos hacia nuestras APIs receptoras deben validar obligatoriamente la firma criptográfica del proveedor (ej. validación de firmas criptográficas de Twilio o Amazon SNS HTTPS signatures).
- **Sanitización de Datos**: Limpieza de caracteres y variables dinámicas para evitar inyección de código malicioso en plantillas HTML compiladas.

---

## CAPÍTULO 12: Observabilidad y Trazabilidad de Comunicaciones

- **Correlación Transaccional**: El `traceId` original del cliente se inyecta en las cabeceras personalizadas de cada correo electrónico (`X-CommerceOS-Trace-ID`) y metadatos de mensajería, permitiendo mapear en CloudWatch toda la cadena de eventos desde el clic de compra hasta el despacho del correo.
- **Slow Delivery Alarms**: Alarma en CloudWatch si el tiempo de retención de mensajes en la cola `SQS Notification Queue` supera los 30 segundos, indicando saturación de envío de APIs.

---

## CAPÍTULO 13: Escalabilidad y Control de Cargas Masivas (Backpressure)

- **Priorización de Colas (Queue Sharding)**:
  - *Priority High*: Mensajes OTP, alertas de seguridad y confirmación de compra.
  - *Priority Medium*: Notificaciones In-App, respuestas de tickets y soporte.
  - *Priority Low*: Campañas de marketing masivas y resúmenes semanales.
- **Backpressure**: Si las APIs de los proveedores externos aplican límites de tasa de peticiones (Rate Limits), el orquestador reduce la concurrencia de lectura de SQS automáticamente, devolviendo los mensajes a la cola con visibilidad retardada de forma controlada.

---

## CAPÍTULO 14: Roadmap de Implementación por Fases

Establecemos un plan estructurado de desarrollo:

### Fase 1: Canales Críticos Transaccionales
- Despliegue de Amazon SES para Email.
- Creación del orquestador base y el Template Engine.
- Integración de notificaciones In-App administrativas y centro de alertas.

### Fase 2: Alertas de Dispositivo y Telefonía
- Integración de Twilio para despacho de SMS de seguridad (Double Factor).
- Integración de Firebase Cloud Messaging (FCM) y APNs para notificaciones push en móviles y navegadores.

### Fase 3: Integraciones Conversacionales y Corporativas
- Despliegue del conector oficial de WhatsApp Business API.
- Adaptadores de chat para Slack y Microsoft Teams (alertas de inventario y soporte).

### Fase 4: Inteligencia de Campañas
- Conexión con Amazon Bedrock para redacción dinámica de plantillas y personalización de contenidos según perfiles de compra de clientes.

---

## CAPÍTULO 15: Checklist de Calidad para Notificaciones

Toda nueva comunicación incorporada a la plataforma debe certificar el cumplimiento de este checklist antes de entrar en producción:

- [ ] **Desacoplamiento Estricto**: Ningún código del módulo invoca APIs de SES o Twilio; el envío se realiza reaccionando a un evento en EventBridge.
- [ ] **Versión de Texto Plano**: El diseño de correo HTML incluye una contraparte en texto plano para clientes de correo accesibles y prevención de spam.
- [ ] **Manejo de Desuscripción**: El correo promocional incluye obligatoriamente el enlace y la cabecera `List-Unsubscribe`.
- [ ] **Validación de Silent Hours**: Las alertas promocionales validan la zona horaria del usuario antes de emitir alertas de sonido en horas de descanso.
- [ ] **Trazabilidad en Cabeceras**: El adaptador del proveedor inyecta el `traceId` y `correlationId` en las cabeceras o metadatos salientes del mensaje.
