# ARCHITECTURE DECISION RECORD (ADR-015)
## ENTERPRISE OPERATIONS, OBSERVABILITY & PLATFORM RELIABILITY FRAMEWORK

**Estado:** APROBADO  
**Contexto:** Gobernanza SRE, Observabilidad Distribuida Serverless, FinOps y Ciclo de Vida de Despliegues Canarios  
**Arquitecto:** Principal Site Reliability Engineer & Cloud Architect  
**Versión:** 1.0.0  

---

## CAPÍTULO 1: Filosofía de Operaciones, SRE y Platform Engineering

### ¿Qué es Observabilidad y Reliability?
- **Observabilidad**: Es la capacidad de inferir el estado interno de un sistema distribuido basándose exclusivamente en el análisis de sus salidas externas de telemetría (logs estructurados, métricas de rendimiento, eventos del sistema y trazas distribuidas).
- **Reliability (Confiabilidad)**: Es la probabilidad de que un sistema opere de forma correcta, sin fallos y dentro de los parámetros de calidad esperados durante un intervalo de tiempo y bajo condiciones operativas específicas.

### Site Reliability Engineering (SRE) vs Platform Engineering:
- **SRE**: Es la disciplina que aplica principios de ingeniería de software a los problemas de infraestructura y operaciones, gobernando la disponibilidad del sistema mediante presupuestos de error y automatización (*Toil Reduction*).
- **Platform Engineering**: Es la disciplina encargada de diseñar y construir el portal o plataforma interna para desarrolladores (Internal Developer Platform - IDP), automatizando el autoservicio de infraestructura para acelerar la entrega de valor con fricción mínima.

### Diferencias lógicas en Telemetría (MELT):
- **Logs**: Registros textuales timestamped detallando un evento específico (ej: error de conexión de base de datos).
- **Métricas**: Agregaciones numéricas estructuradas recolectadas a intervalos regulares (ej: CPU = 45%, tasa de error = 0.5%).
- **Eventos**: Notificaciones explícitas de un cambio de estado significativo en el negocio o la infraestructura.
- **Trazas (Traces)**: Mapeo del ciclo de vida completo de una petición HTTPS a través de múltiples microservicios y Lambdas.

---

## CAPÍTULO 2: Arquitectura General del Pipeline de Confiabilidad

El flujo de telemetría y respuesta operativa de la plataforma se modela bajo el siguiente flujo continuo:

```
[CommerceOS Serverless Core]
       │
       ▼ (1. Ingesta OpenTelemetry SDK)
[Amazon CloudWatch / AWS X-Ray]
       │
       ├── (Exceso de Latencia / Errores 5xx) ──> [Alarmas CloudWatch]
       │                                                 │
       ▼ (Trazas y Logs Correlacionados)                 ▼ (2. Notificación Inmediata)
[OpenTelemetry Collector (Grafana / Datadog)]      [SNS Alarm Broker]
       │                                                 │
       ▼ (3. Análisis Correlacional)                     ▼ (4. PagerDuty / OpsGenie)
[AIOps Engine (Bedrock Model Reader)]             [Alerta a Guardia SRE]
       │                                                 │
       ├──> Auto-resolución ──> [AWS Step Functions (Auto-Healing Runbook)]
       └──> Escalado Manual ──> [War Room Virtual & Postmortem]
```

---

## CAPÍTULO 3: Modelo de Dominio de Operaciones y SRE

Modelamos 27 entidades para soportar el gobierno e infraestructura operativa del sistema:

1. **HEALTH_CHECK**: Configuración de ping o consulta lógica para testear salud del servicio.
2. **SERVICE_STATUS**: Estado de salud general calculado (ej. `OPERATIONAL`, `DEGRADED`, `OUTAGE`).
3. **INCIDENT**: Registro de fallo activo que afecta los niveles de servicio.
4. **ALERT**: Instancia individual de alerta disparada.
5. **ALERT_RULE**: Parámetros de umbral que configuran el disparo de una alarma.
6. **METRIC**: Definición de agregados numéricos indexados por dimensión.
7. **LOG_STREAM**: Secuencia cronológica de registros de texto de una función.
8. **TRACE**: Trazabilidad del flujo completo de una transacción.
9. **SPAN**: Unidad básica de trabajo o segmento dentro de una traza.
10. **DASHBOARD**: Consola visual consolidada de telemetría.
11. **RUNBOOK**: Guía paso a paso estructurada para resolver una alerta.
12. **POSTMORTEM**: Documento retrospectivo inmutable de análisis de fallas raíz.
13. **SLO (Service Level Objective)**: Meta de nivel de servicio acordada (ej. Latencia < 100ms el 99.9% de llamadas).
14. **SLI (Service Level Indicator)**: Medición real del cumplimiento del SLO.
15. **SLA (Service Level Agreement)**: Compromiso legal con penalidad financiera hacia el cliente final.
16. **DEPLOYMENT**: Proceso de compilación e instalación de nueva versión.
17. **RELEASE**: Versión lógica habilitada al público.
18. **FEATURE_FLAG**: Bandera de control dinámico de funcionalidades.
19. **CONFIGURATION**: Variables lógicas del sistema expuestas.
20. **MAINTENANCE_WINDOW**: Ventana horaria planificada de baja criticidad.
21. **BACKUP_POLICY**: Reglas de snapshots y copias de seguridad de datos.
22. **DISASTER_RECOVERY_PLAN**: Flujos de recuperación ante desastres.
23. **CAPACITY_PLAN**: Modelos de proyección de consumo de recursos.
24. **COST_CENTER**: Unidad contable asignada a un departamento o cliente SaaS.
25. **COST_REPORT**: Consolidado de consumo financiero por servicio/módulo.
26. **COST_ALERT**: Alerta disparada al superar presupuestos de nube.
27. **AUDIT_EVENT**: Log de seguridad inmutable de auditorías (AWS CloudTrail).

---

## CAPÍTULO 4: Estrategia de Observabilidad (MELT)

- **Logs Estructurados JSON**: Prohibido usar `console.log()` textual. Todas las Lambdas formatean su salida como objetos JSON planos que contienen: `timestamp`, `level`, `message`, `traceId`, `correlationId`, `requestId`, `domain` y `tenantId`.
- **Trazabilidad Abierta (OpenTelemetry)**: Inyección del encabezado `traceparent` (W3C standard) en todas las llamadas internas y HTTPS de APIs. X-Ray y el colector de OpenTelemetry cruzan las ejecuciones de AWS Lambda, DynamoDB y EventBridge bajo la misma traza unificada.

---

## CAPÍTULO 5: Monitoreo Serverless por Componente

Establecemos indicadores SLI base por servicio de AWS:

- **API Gateway**: Latencia de integración de endpoint, tasa de errores 4xx (errores del cliente), tasa de errores 5xx (caídas de backend).
- **AWS Lambda**: Tasa de ejecuciones fallidas, conteo de inicios en frío (*Cold Starts*), latencia de ejecución, errores de concurrencia y límites excedidos (*Throttling*).
- **Amazon DynamoDB**: Consumo de unidades de lectura (RCU) y escritura (WCU) frente al provisionamiento elástico, y latencias de Get/Put.
- **Amazon EventBridge**: Latencia de enrutamiento y tasa de eventos no entregados (enviados a DLQ).

---

## CAPÍTULO 6: Alertas Inteligentes y Canales de Escalación

Clasificamos las alertas en cuatro verticales operativas:

1. **Alertas Técnicas**: Errores 5xx, timeouts de Lambdas, bases de datos congestionadas (Peligro: Inmediato. Canal: PagerDuty / guardia SRE).
2. **Alertas de Negocio/Comerciales**: Caídas inusuales en la tasa de checkouts completados o ausencia de registros de órdenes en 30 minutos (Peligro: Alto. Canal: Slack / Equipo de Operaciones).
3. **Alertas de Seguridad**: Intentos de inyección de prompts (ADR-014), violaciones de roles IAM u operaciones administrativas fuera de ventanas de mantenimiento (Peligro: Crítico. Canal: SecOps War Room).
4. **Alertas de FinOps**: Desviaciones de costos proyectados de Bedrock o Redshift mayores al 20% diario (Peligro: Medio. Canal: Correo / Centro de costos).

---

## CAPÍTULO 7: Confiabilidad, Presupuestos de Error y Acuerdos de Nivel

Formulamos la gobernanza basada en el presupuesto de error (*Error Budget*):

- **Service Level Objectives (SLOs)**:
  - *Disponibilidad*: El 99.9% de peticiones HTTPS a la API Gateway deben retornar códigos `2xx` o `3xx` en un ciclo mensual.
  - *Latencia*: El 95% de las llamadas de checkout y consulta de catálogos deben responder en menos de **200ms**.
- **Error Budget Policy**: Si el presupuesto de error mensual del 0.1% de caídas se agota antes del fin de mes, se congelan automáticamente todos los despliegues de nuevas funcionalidades por parte del equipo de desarrollo, priorizando únicamente la corrección de bugs y estabilización de la infraestructura.

---

## CAPÍTULO 8: Ciclo de Gestión de Incidentes

- **War Room Virtual**: Ante incidentes P1 (críticos con afectación de checkout o pagos), se abre de inmediato un canal exclusivo de Zoom/Teams automatizado por bots SRE, donde se unen los ingenieros de guardia de Base de Datos, Pagos e Integraciones.
- **Postmortem**: Finalizado el incidente, se compila un reporte retrospectivo libre de culpas (*Blameless Postmortem*) que detalla la causa raíz, la línea de tiempo del evento, el impacto en usuarios y el plan de acciones correctivas inyectadas al roadmap técnico de inmediato.

---

## CAPÍTULO 9: Despliegues Seguros e Invariantes de CI/CD

- **Canary Deployments**: Las Lambdas se actualizan aplicando progresiones de tráfico controladas (ej: desviar 10% del tráfico a la nueva versión durante 10 minutos). Si las métricas de CloudWatch detectan aumentos en la tasa de errores de la nueva versión, se ejecuta un rollback atómico al 100% de la versión estable de forma automatizada por AWS CodeDeploy.
- **Smoke Tests**: Pruebas automáticas ligeras se disparan al 10% del tráfico canario para certificar la salud de la API antes de abrir el tráfico restante.

---

## CAPÍTULO 10: Feature Flags (Gobernanza del Lanzamiento)

- **Gradual Rollout**: Activación de nuevas características a nivel de base de datos segmentando usuarios (ej: habilitar el nuevo calculador de precios B2B únicamente para clientes de la categoría "Silver" en Bogotá).
- **Circuit Breaker Feature**: Si la funcionalidad activa mediante Feature Flag causa picos de error en producción, el interruptor se apaga a nivel de consola administrativa al instante sin requerir redespliegues de código de backend.

---

## CAPÍTULO 11: Estrategia de Respaldo y Disaster Recovery (DR)

- **DynamoDB Point-in-Time Recovery (PITR)**: Habilitado continuamente en la tabla única de DynamoDB, permitiendo restaurar la base de datos a cualquier segundo de los últimos 35 días ante eliminaciones accidentales de datos.
- **Disaster Recovery (RTO & RPO)**:
  - *RTO (Recovery Time Objective)*: Tiempo máximo admisible para restaurar la plataforma ante desastres globales = 1 hora.
  - *RPO (Recovery Point Objective)*: Pérdida máxima de datos admisible en transacciones = 5 minutos (asegurado por replicación continua en base de datos multi-región).

---

## CAPÍTULO 12: FinOps y Gobernanza Financiera Cloud

- **Tagging Strategy Obligatorio**: Todo recurso desplegado en AWS (Buckets, Lambdas, Tablas, Colas) se etiqueta de forma estricta con: `Project = CommerceOS`, `Module = [Payment|DAM|Catalog|Workflow]`, `CostCenter = [SaaSTenantId|CorporateDept]` y `Stage = [dev|prod]`.
- **Forecast y Alertas**: AWS Budgets proyecta mensualmente el consumo y dispara alertas tempranas al rebasar el 80% del gasto límite tolerado.

---

## CAPÍTULO 13: Catálogo de Eventos Operativos del SRE Framework

Definimos los eventos operativos del bus Custom:

### 1. **`SRE.SERVICE_DEGRADED`**
- *Publisher*: `Synthetics Canaries / CloudWatch Monitor`
- *Consumidores*: `Incident Management Engine`, `Notification Broker` (Prioridad: Alta)
- *Payload*: `{ "service": "CheckoutAPI", "metric": "Latency", "currentValue": 650, "threshold": 200 }`

### 2. **`SRE.DEPLOYMENT_ROLLED_BACK`**
- *Publisher*: `AWS CodeDeploy Monitor`
- *Consumidores*: `Slack Dev Alerts Channel`, `SRE Registry` (Prioridad: Alta)

### 3. **`SRE.COST_THRESHOLD_EXCEEDED`**
- *Publisher*: `FinOps Budget Worker`
- *Consumidores*: `Financial Admin Alerts` (Prioridad: Media)

---

## CAPÍTULO 14: Seguridad y Cumplimiento Normativo (ADR-005)

- **AWS CloudTrail**: Bitácora continua que audita toda llamada a las APIs de AWS (creación de recursos, lecturas de secretos, rotaciones de llaves KMS), permitiendo trazabilidad forense completa de cambios de plataforma.
- **AWS Config**: Conformance Packs evalúan de forma continua que los recursos cumplan políticas estándar (ej: encriptación en reposo en todos los buckets de S3 e inhabilitación de accesos públicos SSH directos).

---

## CAPÍTULO 15: Operaciones Autónomas con Inteligencia Artificial (AIOps)

Gobernanza operativa integrada con la IA Platform (ADR-014) y Bedrock:

- **Detección Precoz de Anomalías**: Modelos cognitivos analizan la correlación entre métricas (ej: aumento en inicios en frío de Lambdas coincidiendo con un despliegue canario) y advierten de posibles problemas de rendimiento antes de que fallen los pings de salud.
- **Generador de Borrador de Postmortem**: Finalizado un incidente, la IA lee los logs estructurados, la línea de tiempo del War Room y las trazas afectadas, compilando un borrador del documento retrospectivo detallando causas técnicas raíz sugeridas.

---

## CAPÍTULO 16: Escalabilidad Operativa a Escala Global

- **Multi-Region Active-Active**: Despliegue de CommerceOS en dos regiones de AWS (ej. Virginia y Dublín). Las consultas transaccionales leen de réplicas de DynamoDB locales dinámicas de baja latencia con resolución de conflictos de escritura incorporado.
- **Throttling en API Gateway**: Protección de APIs ante ataques de denegación de servicio (DDoS) limitando la cuota máxima de peticiones por clave de API y cliente corporativo.

---

## CAPÍTULO 17: Roadmap de Platform Engineering e Infraestructura

- **Fase 1: Telemetría y Logs Estructurados**: Formateo JSON de logs, inyección de traceId e integración en CloudWatch.
- **Fase 2: Alarmas y Notificaciones**: Despliegue de alarmas de SLIs base y canales de escalación automáticos.
- **Fase 3: Gobernanza SRE y SLOs**: Establecimiento formal de presupuestos de error y tableros en Grafana.
- **Fase 4: Despliegues Canarios y Feature Flags**: Automatización de rollbacks y control dinámico de banderas lógicas.
- **Fase 5: FinOps Avanzado y DR**: Monitoreo detallado de costos unitarios de nube y simulacros de Disaster Recovery en caliente.
- **Fase 6: AIOps y Auto-Healing**: Soporte cognitivo para auto-corrección de fallos menores en infraestructura.

---

## CAPÍTULO 18: Checklist Operativo de Producción

Ningún microservicio o cambio de código en CommerceOS es aprobado para producción si no certifica este checklist operativo:

- [ ] **Estructuración de Logs**: Toda salida de consola sigue el esquema plano JSON con cabeceras de trazabilidad.
- [ ] **Mapeo de SLOs**: Declaración de SLIs de latencia y disponibilidad con su respectiva alarma de CloudWatch asociada.
- [ ] **Runbook de Emergencia**: Documento instructivo enlazado a cada alarma declarando los pasos de resolución.
- [ ] **Etiquetado FinOps**: Todos los recursos desplegados en CloudFormation/Serverless contienen las etiquetas mandatorias de centro de costos.
- [ ] **Políticas de Respaldo**: Tablas y buckets cuentan con snapshots automáticos e historial de retención declarada.
