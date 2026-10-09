# ARCHITECTURE DECISION RECORD (ADR-009)
## WORKFLOW & AUTOMATION FRAMEWORK

**Estado:** APROBADO  
**Contexto:** Arquitectura de Orquestación de Procesos, Motores de Automatización Serverless y Flujos de Trabajo Visuales  
**Arquitecto:** Principal Solutions Architect (Especialista en Step Functions, Temporal & Workflow Automation)  
**Versión:** 1.0.0  

---

## CAPÍTULO 1: Filosofía del Framework

### ¿Qué es un Workflow Engine?
Un Workflow Engine (Motor de Flujos de Trabajo) es un sistema diseñado para definir, ejecutar y administrar secuencias lógicas de tareas (flujos de trabajo) de forma estructurada, visual y altamente configurable, actuando como el orquestador del estado de procesos de larga o corta duración.

### ¿Por qué desacoplar la lógica de negocio del código transaccional?
Codificar de forma rígida (*hardcoding*) cada proceso de automatización dentro de las funciones Lambda del dominio comercial (ej: escribir código Node.js en la Lambda de Checkout que valide si la orden supera los $500 para enviar un email especial) genera graves ineficiencias:
1. **Ineficiencia Operativa**: Cualquier modificación en las reglas de negocio (ej. subir el umbral del email especial a $1000) requeriría un ciclo completo de modificación de código, compilación, pruebas y despliegue por parte de desarrollo.
2. **Pérdida de Visibilidad**: El equipo administrativo y de operaciones carece de visibilidad del estado de ejecución del proceso. No hay manera visual de diagnosticar dónde se detuvo una transacción o qué condiciones fallaron.
3. **Escalabilidad y Control de Errores**: Diseñar flujos con esperas temporales prolongadas (ej: esperar 3 días antes de enviar un recordatorio) usando Lambdas activas es costoso y expone el sistema a timeouts físicos.

### Beneficios del Desacoplamiento:
- **Agilidad del Producto (SaaS)**: Operadores sin conocimientos de programación pueden crear, modificar y suspender flujos lógicos en caliente mediante una interfaz visual sin desplegar código.
- **Resiliencia bpm-style**: Manejo integrado de transacciones compensatorias (deshacer cambios anteriores) y reintentos por paso.

---

## CAPÍTULO 2: Arquitectura General de Automatización

Establecemos una separación estricta entre la **emisión del trigger** y la **orquestación lógica** a través del bus elástico de EventBridge:

```
[Origen del Evento: Trigger] 
       │
       ▼ (EventBridge Rule)
[EventBridge Custom Bus]
       │
       ▼ (Dispara Orquestación)
[AWS Step Functions (Orchestrator Engine)]
       │
       ├──> [State Reader (DynamoDB)] ──> Obtiene definición de Pasos
       │
       ├──> [Condition Evaluator] ──────> Compara variables y bifurcaciones
       │
       └──> [Action Dispatcher (SQS)] ──> Enruta pasos a conectores de ejecución
                                                │
                                                ├──> [Conector Slack/WhatsApp]
                                                ├──> [Conector Stripe]
                                                └──> [Conector OpenAI / Bedrock]
```

### Componentes de la Solución:
- **Workflow State Machine**: Implementado utilizando AWS Step Functions (Express Workflows para ejecuciones rápidas de alto volumen y Standard Workflows para procesos de larga duración con esperas o aprobaciones humanas).
- **Condition Evaluator**: Motor de evaluación JSON Schema / JSON Path que resuelve expresiones booleanas en microsegundos sin coste de CPU de servidor.
- **Action Dispatcher**: Emite comandos hacia colas SQS para que los adaptadores de integración ejecuten las llamadas a APIs externas de forma amortiguada.

---

## CAPÍTULO 3: Modelo de Dominio del Framework

Diseñamos 13 entidades que modelan el ciclo de vida del flujo de automatización:

1. **WORKFLOW**: Entidad raíz que contiene el ID, nombre, descripción del flujo y estado activo (`ACTIVE`, `INACTIVE`).
2. **WORKFLOW_VERSION**: Rastrea los cambios históricos. Almacena la estructura BPMN/JSON definitiva de los pasos del flujo.
3. **WORKFLOW_TRIGGER**: Define el evento desencadenante (ej: `EventName = COMMERCE.ORDER_PAID`).
4. **WORKFLOW_STEP**: Un nodo de ejecución individual dentro del flujo.
5. **WORKFLOW_CONDITION**: Nodos de bifurcación que evalúan variables lógicas (If/Else, Switch).
6. **WORKFLOW_ACTION**: Tareas que ejecutan operaciones físicas (ej. enviar mensaje, actualizar base de datos).
7. **WORKFLOW_VARIABLE**: Definición taxonómica de datos dinámicos requeridos por el flujo.
8. **WORKFLOW_EXECUTION**: Registro de una corrida activa del flujo.
   - *Estados*: `PENDING` -> `RUNNING` -> `COMPLETED` / `FAILED` -> `CANCELLED` / `TIMED_OUT`.
9. **WORKFLOW_LOG**: Historial inmutable y secuencial de cada paso ejecutado para auditoría.
10. **WORKFLOW_SCHEDULE**: Tareas programadas en el tiempo vinculadas al flujo.
11. **WORKFLOW_TEMPLATE**: Plantillas prediseñadas listas para ser clonadas por los usuarios.
12. **WORKFLOW_APPROVAL**: Tareas humanas de autorización que suspenden la ejecución del flujo hasta recibir aprobación.
13. **WORKFLOW_ERROR**: Registro forense de excepciones, códigos de error y fallos de proveedores de conector.

---

## CAPÍTULO 4: Catálogo de Triggers Soportados

El motor es agnóstico del origen de la señal de disparo. Soporta:

- **Triggers por Eventos de Negocio**: Reacción inmediata a eventos publicados en EventBridge (confirmaciones de pedido, bajas de stock, subidas completas en el DAM).
- **Triggers de Tiempo (Schedules)**: Ejecuciones programadas mediante expresiones CRON (ej: "Ejecutar todos los lunes a las 08:00") o fechas absolutas (ej. "Enviar alerta el 24 de Diciembre").
- **Triggers de Entrada Externa (Webhooks & APIs)**: Llamadas externas directas con tokens de seguridad (ej. Stripe notifica un contracargo vía webhook).
- **Cambio de Estado de Entidad**: Detección CDC sobre DynamoDB que dispara flujos de trabajo cuando un atributo cambia (ej. el estado de un ticket de soporte pasa a `URGENTE`).

---

## CAPÍTULO 5: Condiciones y Bifurcaciones Lógicas

El evaluador de condiciones resuelve operaciones booleanas complejas sobre el payload utilizando expresiones JSON Path:

- **Operadores de Comparación**: `Equals`, `NotEquals`, `Contains`, `StartsWith`, `RegexMatch`, `GreaterThan`, `LessThan`.
- **Condiciones Contextuales**: Evaluación de fecha, hora actual y zonas horarias para enrutamiento inteligente de alertas (ej. si es fuera del horario comercial, desviar alerta a soporte de guardia).
- **Validaciones de Seguridad**: Bifurcaciones basadas en los roles RBAC y permisos ABAC del actor que desencadenó el evento.
- **Variables de Negocio**: Comparaciones basadas en el valor del pedido (`amount > 500`), inventario disponible, localización geográfica del cliente y segmentación en el CRM.

---

## CAPÍTULO 6: Catálogo de Acciones del Sistema

Una vez aprobada la lógica, el despachador ejecuta tareas transaccionales nativas dentro de CommerceOS:

- **Gestión de Ventas**: Creación, actualización, facturación y borrado lógico de pedidos.
- **Inventario**: Reserva, liberación e incremento de stock de productos.
- **Comunicaciones**: Despacho de correos, SMS, WhatsApp e hilos push consumiendo el Notification Framework (ADR-008).
- **Fidelización**: Aplicación de cupones de descuento, emisión de tarjetas de regalo (Gift Cards) y actualización de niveles de fidelidad.
- **Extensiones Físicas**: Llamar a endpoints HTTP de APIs externas (REST/GraphQL), ejecutar Lambdas específicas del cliente o invocar Step Functions de procesos secundarios.

---

## CAPÍTULO 7: Workflow Builder Visual

La consola administrativa de CommerceOS expone un editor web interactivo tipo Canvas:

- **Drag & Drop de Nodos**: Lienzo interactivo para arrastrar triggers, condiciones y acciones, conectándolos con flechas direccionales de secuencia lógica.
- **Validación Estricta de Mapeo**: El editor valida en tiempo real que los tipos de datos de salida de un nodo coincidan con las entradas requeridas por el nodo siguiente (ej: evitar pasar una cadena de texto a un conector de stock numérico).
- **Simulador e Histórico de Pruebas**: Panel de pruebas que permite inyectar un payload JSON de prueba y previsualizar de forma animada qué ramas del flujo se ejecutarán y dónde ocurrirían fallos de red.

---

## CAPÍTULO 8: Ámbitos de Variables y Contexto de Datos

El motor gestiona el flujo de datos dividiéndolo en cinco niveles de visibilidad y aislamiento:

- **Global Variables**: Parámetros compartidos por toda la organización (ej: URL base del BFF, datos de branding).
- **Event Variables**: Datos de lectura del sobre del evento (`eventId`, `traceId`, `correlationId`).
- **Workflow Scope**: Variables declaradas a nivel de la máquina de estado compartidas entre todos sus pasos.
- **Local / Step Variables**: Variables temporales creadas en la salida de un paso anterior y consumidas exclusivamente por el paso inmediato siguiente.
- **Secrets Store**: Integración con **AWS Secrets Manager** para cifrar y ocultar llaves de APIs externas y tokens de portales de pago durante ejecuciones visuales de log.

---

## CAPÍTULO 9: Conectores e Integraciones Externas

Establecemos adaptadores estándar para portales externos populares:

- **Mensajería Instantánea**: Adaptadores para Telegram Bot API, WhatsApp Business API, Slack Webhooks y Microsoft Teams.
- **Pasarelas de Pago**: Conectores bidireccionales con Stripe, Mercado Pago y PayPal para conciliar devoluciones y auditorías.
- **Marketing y Analytics**: Integraciones con Google Analytics, Meta Ads y TikTok Conversions API.
- **Inteligencia Artificial**: Adaptadores para interactuar con modelos generativos (AWS Bedrock y OpenAI API) para resúmenes de texto o clasificaciones automáticas.

---

## CAPÍTULO 10: Flujos de Aprobación Humana (Human-in-the-Loop)

Para tareas críticas que requieren supervisión física (ej: autorizar un reembolso superior a $1000), el motor suspende la ejecución automática:

- **Token de Espera (Task Token)**: Step Functions pausa el flujo emitiendo un `Task Token` y registra una entrada en la tabla `WORKFLOW_APPROVAL`.
- **Escalamiento y Tiempos**: Si el aprobador principal no autoriza el flujo en un lapso de 24 horas, el motor aplica una regla de escalamiento desviando el token hacia un rol de supervisión superior o enviando recordatorios recurrentes.
- **Resolución**: Cuando el operador presiona "Aprobar" o "Rechazar" en el panel administrativo, el sistema envía el callback de respuesta a Step Functions, reanudando la ejecución.

---

## CAPÍTULO 11: Control de Errores y Transacciones Compensatorias

La resiliencia en un motor de flujos de trabajo distribuido se rige bajo las siguientes políticas de mitigación de excepciones:

- **Reintentos Inteligentes con Backoff**: Configuraciones de reintentos exponencialmente retardados con un factor multiplicador (ej. reintentar a los 5s, luego 25s, luego 125s) y jitter aleatorio para no saturar APIs externas.
- **Dead Letter Queue (DLQ)**: Si una acción excede el máximo de reintentos permitidos (ej. 5 fallos consecutivos), la tarea se retira del pipeline principal y se guarda en la cola SQS de errores para inspección de los operadores del sistema.
- **Transacciones Compensatorias**: Si un paso intermedio falla y no puede completarse, el motor ejecuta la rama de compensación regresando los recursos modificados a su estado original (ej: si falla el cobro, se libera el stock previamente reservado de forma atómica).

---

## CAPÍTULO 12: Observabilidad, Métricas y Trazabilidad de Automatización

- **Correlación Extensible**: El `traceId` y `correlationId` se propagan de forma mandatoria en los metadatos de Step Functions, permitiendo a AWS X-Ray cruzar los tiempos de ejecución de la automatización con la base de datos y la interfaz de usuario.
- **CloudWatch Dashboards**: Monitoreo de:
  - `ExecutionDuration`: Tiempo promedio requerido para finalizar ejecuciones completas de workflows.
  - `StepFailureRate`: Tasa de fallos clasificada por tipo de acción y conector.
  - `AutomationCost`: Cálculo estimado del gasto de ejecución serverless de la máquina de estado.

---

## CAPÍTULO 13: Catálogo de Eventos del Motor de Flujos de Trabajo

Definimos los eventos de automatización publicados en EventBridge:

### 1. **`WORKFLOW.STARTED`**
- *Publisher*: `Workflow Engine Orchestrator`
- *Consumidores*: `Audit Service`, `Analytics Indexer` (Prioridad: Media)
- *Payload*: `{ "workflowId": "wfl_111", "executionId": "exec_888", "triggeredBy": "evt_order_paid" }`

### 2. **`WORKFLOW.STEP_FAILED`**
- *Publisher*: `Workflow Step Processor`
- *Consumidores*: `Notification Hub` (Prioridad: Alta)
- *Payload*: `{ "workflowId": "wfl_111", "stepId": "step_send_sms", "error": "Provider offline" }`

### 3. **`WORKFLOW.COMPLETED`**
- *Publisher*: `Workflow Engine Orchestrator`
- *Consumidores*: `Analytics Service` (Prioridad: Baja)

### 4. **`WORKFLOW.APPROVED`**
- *Publisher*: `Approval Service Console`
- *Consumidores*: `Workflow Engine Callback` (Prioridad: Alta)

---

## CAPÍTULO 14: Estrategia de Seguridad e Identidad del Motor (ADR-005)

- **Aislamiento Multitenant**: Las ejecuciones de flujos de trabajo e identidades de DynamoDB están segmentadas por el atributo global `tenantId`. Un inquilino SaaS nunca podrá leer ni desencadenar las automatizaciones de otra organización corporativa.
- **Restricción de Privilegios de Ejecución**: La Step Function ejecuta tareas asumiendo un rol IAM restringido. Si el usuario intenta ejecutar un conector con privilegios elevados (ej: borrar base de datos), el orquestador valida el perfil RBAC del usuario final contra la política de permisos del conector.
- **Auditoría inmutable de Logs**: Todo log de ejecución de pasos se guarda cifrado en CloudWatch Logs con retención de 1 año con políticas WORM (Write Once, Read Many).

---

## CAPÍTULO 15: Inteligencia Artificial en Automatizaciones

Adoptamos el uso de IA generativa acoplada al motor de flujos:

- **Cocreación de Flujos**: El operador administrativo puede describir el flujo deseado en lenguaje natural (ej: "Si un cliente vip compra más de $300, envíale un cupón de 10% y avisa en el canal de ventas de Slack"). AWS Bedrock traduce este requerimiento a la definición JSON estructural del workflow de Step Functions automáticamente.
- **Detección de Cuellos de Botella**: Modelos predictivos analizan los logs históricos de ejecuciones detectando qué pasos o conectores externos están ralentizando los procesos o costando más dinero, sugiriendo optimizaciones en caliente.

---

## CAPÍTULO 16: Escalabilidad y Gestión de Concurrencia Masiva

- **Segregación de Ejecuciones**:
  - *Express Workflows*: Utilizado para flujos rápidos, eficientes y transaccionales (ej: validaciones de inventario y alertas inmediatas). Soporta tasas superiores a 100,000 ejecuciones por segundo.
  - *Standard Workflows*: Utilizado para flujos complejos de larga duración que involucran esperas de tiempo o aprobaciones humanas.
- **Concurrencia y Throttling**: El motor implementa controles de tasa de refresco a nivel de conector para evitar saturar sistemas de bases de datos internas o APIs externas.

---

## CAPÍTULO 17: Roadmap de Implementación del Motor

Establecemos un despliegue en seis etapas operativas consecutivas:

- **Fase 1**: Desarrollo del motor base con AWS Step Functions y conectores básicos (Lambdas y Base de Datos).
- **Fase 2**: Lanzamiento del editor visual web Drag & Drop (Workflow Builder) en el panel administrativo.
- **Fase 3**: Catálogo de plantillas maestras y configuraciones predefinidas.
- **Fase 4**: Marketplace que permite a integradores externos publicar nuevos conectores del sistema.
- **Fase 5**: Inteligencia generativa de Bedrock para creación de flujos mediante lenguaje natural.
- **Fase 6**: Autooptimización y análisis predictivo de logs.

---

## CAPÍTULO 18: Checklist de Calidad para Automatizaciones

Cualquier proceso automático incorporado a CommerceOS debe certificar la lista de control:

- [ ] **Manejo de Tiempos**: Ninguna Step Function Standard queda suspendida indefinidamente sin especificar un Timeout máximo por paso.
- [ ] **Estrategia Compensatoria**: Toda acción de escritura externa cuenta con una contraparte lógica de compensación o rollback ante fallos.
- [ ] **Cifrado de Credenciales**: Las claves de acceso de APIs externas de conectores consumen variables protegidas por AWS Secrets Manager.
- [ ] **Propagación Forense**: El payload de ejecución hereda e inyecta el `traceId` y `correlationId` para análisis de observabilidad.
- [ ] **Políticas Opt-in en Mensajería**: Toda acción que involucre mensajería a clientes finales valida previamente las preferencias registradas en el Notification Hub (ADR-008).
