# ARCHITECTURE DECISION RECORD (ADR-010)
## ENTERPRISE INTEGRATION FRAMEWORK

**Estado:** APROBADO  
**Contexto:** Arquitectura de Integración Empresarial, iPaaS Serverless y Abstracción de Proveedores Externos  
**Arquitecto:** Principal Enterprise Integration Architect (Especialista en EIP, Hexagonal & Event Driven Architecture)  
**Versión:** 1.0.0  

---

## CAPÍTULO 1: Filosofía del Framework

### ¿Qué es una Enterprise Integration Platform (iPaaS)?
Una Enterprise Integration Platform (Plataforma de Integraciones Empresarial) es un middleware centralizado que orquesta, asegura, traduce y audita todas las conexiones lógicas e intercambio de datos entre los dominios internos de una aplicación (CommerceOS) y el ecosistema de sistemas externos (pasarelas de pago, operadores de logística, ERPs, CRMs y APIs de terceros).

### ¿Por qué desacoplar el dominio de los proveedores externos?
Acoplar directamente APIs de terceros como Stripe, Mercado Pago o DHL en las capas del dominio (ej: invocar la SDK de Stripe dentro de la lógica del agregado `Order`) es un antipatrón grave:
1. **Contaminación de Dominio**: El lenguaje y tipados de terceros contaminan los modelos del dominio. Si Stripe cambia su firma de API o introduce un cambio disruptivo, la lógica comercial del negocio sufre inestabilidad.
2. **Inflexibilidad del Negocio**: Reemplazar un proveedor de envíos (ej: cambiar de DHL a FedEx) exigiría reescribir código nuclear, rehacer pruebas transaccionales y redesplegar servicios principales, elevando el riesgo operativo.
3. **Ausencia de Gobernanza**: Las llaves de API y credenciales de autenticación quedan dispersas en variables de entorno locales, imposibilitando rotaciones coordinadas o auditorías de seguridad unificadas.

### Beneficios del Desacoplamiento (Capa Intermedia):
- **Independencia Tecnológica**: El dominio interactúa únicamente con "Contratos de CommerceOS". El backend desconoce qué pasarela procesó físicamente la tarjeta de crédito.
- **Intercambiabilidad en Caliente**: Habilitar, apagar o conmutar pasarelas de pago por caídas se realiza a nivel administrativo (Base de Datos) en tiempo real sin tocar una sola línea de código del dominio.

---

## CAPÍTULO 2: Arquitectura General (Hexagonal & EIP)

El framework funciona bajo los patrones de **Arquitectura Hexagonal (Puertos y Adaptadores)** y **Enterprise Integration Patterns (EIP)**:

```
[Dominio Transaccional]
       │
       ▼ (1. Emite Solicitud / Evento de Contrato de Dominio)
[EventBridge Custom Bus]
       │
       ▼ (2. Regla de Enrutamiento)
[Integration Engine Orchestrator]
       │
       ├──> [Secrets Manager Resolver] ──> Resuelve credenciales cifradas
       ├──> [Mapping Engine] ───────────> Transforma JSON Dominio a JSON Proveedor
       └──> [Resilience Handler] ──────> Controla timeouts, reintentos y límites
       │
       ▼ (3. Despacho Criptográfico)
[Provider Adapter (Stripe, DHL, SAP)]
       │
       ▼ (4. HTTPS Request)
[API de Proveedor Externo]
       │
       ▼ (5. HTTP Response)
[Provider Adapter (Respuesta Cruda)]
       │
       ▼ (6. Inversión de Mapeo)
[Mapping Engine] ──> (Traduce JSON Proveedor a Contrato de Dominio)
       │
       ▼ (7. Emite Evento de Confirmación)
[EventBridge Custom Bus] ──> [Dominio Transaccional (Actualiza Estado)]
```

---

## CAPÍTULO 3: Modelo de Dominio de Integraciones

Modelamos 16 entidades para asegurar gobernanza y auditoría en la capa de persistencia:

1. **INTEGRATION**: Registro maestro de la integración (ID, nombre, estado `ACTIVE`/`INACTIVE`).
2. **INTEGRATION_PROVIDER**: Catálogo de adaptadores del sistema (Stripe, DHL, OpenAI, HubSpot).
3. **INTEGRATION_CONFIGURATION**: Parámetros operativos (ej. monedas soportadas, puertos de embarque).
4. **INTEGRATION_CREDENTIAL**: Referencias de llaves cifradas (IDs de Secrets Manager). No guarda el secreto.
5. **INTEGRATION_ENDPOINT**: URLs físicas e interfaces expuestas de la API del tercero.
6. **INTEGRATION_WEBHOOK**: Registro de endpoints de CommerceOS expuestos para recibir CDC del tercero.
7. **INTEGRATION_EVENT**: Bitácora del esquema de datos que transita por el framework.
8. **INTEGRATION_MAPPING**: Reglas de traducción semántica (declaraciones de transformación JSON/XML).
9. **INTEGRATION_LOG**: Auditoría de cada llamada saliente/entrante (URL, payload cifrado, latencia, IP).
10. **INTEGRATION_JOB**: Procesos asíncronos en segundo plano (ej: sincronizaciones de inventario ERP nocturnas).
11. **INTEGRATION_RETRY**: Registro de reintentos exponencialmente configurados por transacción.
12. **INTEGRATION_SECRET**: Firma criptográfica HMAC para certificar autenticidad de webhooks recibidos.
13. **INTEGRATION_HEALTH**: Monitoreo de disponibilidad del proveedor (tasas de error 5xx, latencias).
14. **INTEGRATION_RATE_LIMIT**: Cuotas y límites de velocidad declarados por el proveedor externo.
15. **INTEGRATION_POLICY**: Políticas de seguridad aplicadas (ej. exclusión de envío de datos PII de clientes).
16. **INTEGRATION_VERSION**: Control de compatibilidad y deprecación de APIs del tercero.

---

## CAPÍTULO 4: Patrón Adapter y Contratos Comunes

Cada adaptador de integración implementa un contrato estricto (*Interface contract*) según su categoría:

### Contrato de Pagos (`IPaymentGateway`)
- **`authorizePayment(amount, currency, cardToken)`**
- **`capturePayment(transactionId, amount)`**
- **`refundPayment(transactionId, amount, reason)`**

### Contrato de Logística (`IShippingCarrier`)
- **`calculateRates(origin, destination, weight, dimensions)`**
- **`createShipment(labelData, pickupAddress)`**
- **`trackShipment(trackingNumber)`**

### Contrato de IA (`IAIEngine`)
- **`generateEmbeddings(textInput)`**
- **`executePrompt(systemInstruction, userInput)`**

Los adaptadores específicos (ej: `StripeAdapter`, `DHLAdapter`, `BedrockAdapter`) actúan como traductores, implementando estas funciones y mapeando los resultados crudos a las firmas estandarizadas de CommerceOS.

---

## CAPÍTULO 5: Conectores Reutilizables

El motor expone conectores de protocolo agnósticos para interactuar con sistemas legados o APIs personalizadas sin reescribir infraestructura:

- **REST Connector**: Despacho de payloads JSON sobre HTTPS con soporte para OAuth2 dinámico.
- **GraphQL Connector**: Ejecución de Queries y Mutations.
- **SOAP Connector**: Envoltorio XML sobre HTTPS para integraciones ERP clásicas.
- **SFTP/FTP Connector**: Conector de archivos batch para envíos de catálogos masivos o facturación mensual en formato CSV.

---

## CAPÍTULO 6: Gestión Segura de Credenciales (Secrets Manager)

- **Aislamiento Total**: Queda prohibido almacenar claves privadas, llaves de API o contraseñas en variables de entorno de Lambdas o código de repositorios.
- **AWS Secrets Manager**: Las credenciales se almacenan cifradas con llaves personalizadas de **AWS KMS**.
- **Rotación Automática**: Tareas Step Functions invocan periódicamente la rotación de contraseñas de APIs de terceros (si el proveedor lo admite), actualizando la referencia de Secrets Manager de forma transparente.

---

## CAPÍTULO 7: Framework de Webhooks Entrantes

Para recibir notificaciones del estado de operaciones (ej: Stripe avisa que un pago se completó horas después en disputas), diseñamos el pipeline de ingesta de Webhooks:

```
[Proveedor API Webhook] ──> [API Gateway / CORS] ──> [Webhook Lambda Receiver]
                                                            │
                                                            ├──> Valida firma HMAC
                                                            ├──> De-duplica (Upstash Redis)
                                                            └──> Publica Evento Ingesta
                                                                    │
                                                                    ▼
                                                          [EventBridge Custom Bus]
```

### Reglas de Seguridad en Ingesta de Webhooks:
- **Validación de Firma Criptográfica**: Toda llamada entrante debe ser firmada mediante firmas HMAC. El receptor descarga la clave del webhook de Secrets Manager y valida la coincidencia en cabeceras.
- **Protección Replay Attacks**: Cabeceras con marcas temporales (*timestamps*) se validan para rechazar peticiones duplicadas o con diferencias mayores a 5 minutos.

---

## CAPÍTULO 8: Mapping Engine (Traducción de Datos)

El motor de traducción (*Mapping Engine*) realiza conversiones bilaterales dinámicas sin intervención de código del dominio:

- **Mapeos Declarativos**: Uso de plantillas JSON-to-JSON (ej: Liquid Templates o especificaciones JOLT) para reordenar atributos (ej: convertir la propiedad `street_address` de DHL al atributo `address1` de CommerceOS).
- **Conversión de Moneda y Medidas**: Conversión automática en tiempo real de pesos (libras a kilogramos), distancias (pulgadas a centímetros) y monedas extranjeras utilizando tipos de cambio integrados en el conector financiero.

---

## CAPÍTULO 9: Versionado y Retrocompatibilidad de APIs

- **Connector Versioning**: Los conectores se versionan semánticamente (`v1.0.0`, `v2.0.0`).
- **Retrocompatibilidad**: Si Stripe actualiza su API de la versión `2023` a la `2026`, se despliega el adaptador `StripeAdapter_v2` en el framework. Los inquilinos SaaS continúan consumiendo la versión anterior en producción mientras se planifica una migración segura.

---

## CAPÍTULO 10: Resiliencia Distribuida ante Caídas de Terceros

CommerceOS protege la estabilidad de sus transacciones aplicando los siguientes patrones de resiliencia:

- **Circuit Breaker (Cortocircuito)**: Si un proveedor externo (ej. PayPal) retorna errores 503 consecutivos (tasa superior al 50% en un intervalo de 1 minuto), el cortocircuito se abre inmediatamente. Todas las llamadas subsiguientes fallan de forma anticipada sin consumir tiempo de Lambda y se desvían al método alternativo (`Fallback`), como activar Stripe automáticamente.
- **Bulkhead (Aislamiento de Recursos)**: Reservamos cuotas de concurrencia y colas SQS independientes por proveedor. Si DHL se congestiona o se ralentiza, sus reintentos y mensajes en espera no afectan el pipeline de cobros de Stripe.

---

## CAPÍTULO 11: Observabilidad y OpenTelemetry

- **OpenTelemetry Standard**: Implementamos trazabilidad distribuida inyectando cabeceras de trazas estándar (`traceparent` de W3C). Las trazas continúan fluyendo si el proveedor externo propaga la cabecera en sus respuestas de webhook.
- **Health Check Status**: Pings periódicos de conexión y tasas de error 4xx/5xx calculan el porcentaje de disponibilidad (*Uptime*) de cada proveedor en tiempo real.

---

## CAPÍTULO 12: Catálogo de Eventos del Enterprise Integration Framework

Definimos los eventos del bus asociados a integraciones:

### 1. **`INTEGRATION.WEBHOOK_RECEIVED`**
- *Publisher*: `Webhook Receiver API`
- *Consumidores*: `Idempotency Checker`, `Audit Log Service` (Prioridad: Alta)
- *Payload*: `{ "webhookId": "wh_111", "provider": "Stripe", "rawBody": "..." }`

### 2. **`INTEGRATION.PROVIDER_TIMEOUT`**
- *Publisher*: `Integration Orchestrator`
- *Consumidores*: `Circuit Breaker Monitor`, `Slack Alarms Channel` (Prioridad: Alta)

### 3. **`INTEGRATION.CONNECTION_TEST_FAILED`**
- *Publisher*: `Integration Registry Service`
- *Consumidores*: `Audit Service`, `Console Notifications` (Prioridad: Media)

---

## CAPÍTULO 13: Seguridad, Gobernanza y Redes

- **mTLS (Mutual TLS)**: Para conexiones de alta criticidad financiera (ej: integraciones ERP bancarias), configuramos enlaces TLS mutuos forzando la validación del certificado digital del cliente.
- **IP Allow Lists**: Restricción de tráfico saliente a través de una **NAT Gateway** con una IP elástica estática (`Elastic IP`), permitiendo a los clientes corporativos configurar sus firewalls para recibir únicamente peticiones de CommerceOS.

---

## CAPÍTULO 14: Analytics e Indicadores de Integración

Registramos métricas en CloudWatch para alimentar dashboards gerenciales de integraciones:

- **Latencia de Proveedor (Round-trip Latency)**: Tiempo total que toma al proveedor responder las solicitudes HTTPS.
- **Tasa de Consumo de Cuotas (Rate Limit Pressure)**: Monitoreo de qué tan cerca estamos de agotar la cuota de llamadas permitidas por las APIs de los proveedores (ej: advertencia si superamos el 80% de llamadas en Shopify API).

---

## CAPÍTULO 15: Marketplace y Panel de Control Administrativo

El panel administrativo SaaS de CommerceOS actúa como consola de administración centralizada de integraciones:

- **Instalación sin Código (No-Code Plugins)**: Los administradores instalan nuevos conectores seleccionándolos en el panel.
- **Feature Flag Control**: Activar o desactivar un conector modifica una bandera booleana (`isActive = true/false`) en la tabla `INTEGRATION_CONFIGURATION`. El motor de enrutamiento deshabilita la ruta de inmediato sin alterar el dominio.

---

## CAPÍTULO 16: Inteligencia Artificial en Integraciones (Bedrock Integration)

Integración de algoritmos cognitivos para facilitar mapeos y mantenimiento:

- **Auto-Mapping Predictivo**: Cuando se instala un sistema ERP personalizado de un cliente corporativo, la IA ( Bedrock Titan) analiza la estructura del esquema JSON del tercero y propone el mapeo de equivalencias hacia las entidades del catálogo de CommerceOS de forma automatizada, reduciendo días de desarrollo a segundos.
- **Falla Predictiva**: Analizadores predictivos detectan incrementos porcentuales sutiles en las latencias de respuesta de un proveedor de envíos antes de que falle del todo, recomendando desviar preventivamente el tráfico logístico.

---

## CAPÍTULO 17: Escalabilidad de Integraciones

- **Indexación Asíncrona Masiva**: Despacho de actualizaciones masivas (ej. sincronizar 1 millón de SKUs de stock del ERP) mediante flujos de trabajo Step Functions divididos en ejecuciones paralelas segmentadas (*Map State*), procesando hasta 10,000 sub-llamadas en paralelo con límites de backpressure controlados.

---

## CAPÍTULO 18: Roadmap de Integración por Fases

- **Fase 1**: Desarrollo del motor iPaaS base, Secrets Manager Integration y Webhook Receiver.
- **Fase 2**: Adaptadores y conectores financieros para pagos (Stripe, PayPal, MercadoPago).
- **Fase 3**: Conectores de transportadoras y operadores logísticos (DHL, FedEx).
- **Fase 4**: Adaptadores de Marketing, CRM y analíticas de embudo (HubSpot, Google Analytics).
- **Fase 5**: Sincronizadores de ERP corporativos clásicos (SAP, QuickBooks).
- **Fase 6**: Lanzamiento del Marketplace oficial de plugins y mapeador inteligente con IA.

---

## CAPÍTULO 19: Checklist de Integridad para Conectores

Todo nuevo adaptador desarrollado debe certificar los siguientes controles de calidad:

- [ ] **Desacoplamiento Absoluto**: El conector expone la implementación del contrato de CommerceOS sin fugas de tipado o SDKs del tercero hacia el dominio.
- [ ] **Tratamiento de Excepciones**: Captura todos los errores de red, parsea códigos 4xx/5xx y los transforma en un código de error tipado de CommerceOS.
- [ ] **Garantía de Idempotencia**: La llamada de webhook entrante utiliza cabeceras de de-duplicación atómica en Redis antes de procesar el evento.
- [ ] **Rotación de Secretos**: La autenticación consume tokens desde Secrets Manager con retención en caché de 5 minutos máxima.
- [ ] **Políticas PII Activas**: Filtra y enmascara logs de peticiones para asegurar que datos bancarios, contraseñas o datos personales sensibles de clientes no se guarden en texto claro en CloudWatch.
