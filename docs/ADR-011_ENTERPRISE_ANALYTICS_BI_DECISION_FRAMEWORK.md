# ARCHITECTURE DECISION RECORD (ADR-011)
## ENTERPRISE ANALYTICS, BUSINESS INTELLIGENCE & DECISION INTELLIGENCE FRAMEWORK

**Estado:** APROBADO  
**Contexto:** Arquitectura de Datos a Escala Petabyte, Analítica de Negocio y Modelos Predictivos  
**Arquitecto:** Principal Data & Analytics Architect (Especialista en Athena, Redshift, Glue & QuickSight)  
**Versión:** 1.0.0  

---

## CAPÍTULO 1: Filosofía del Framework

### ¿Qué es Business Intelligence (BI) y Decision Intelligence (DI)?
- **Business Intelligence (BI)**: Es el conjunto de procesos, tecnologías y herramientas que transforman datos crudos en información estructurada y reportes interactivos para describir el comportamiento histórico y actual del negocio.
- **Decision Intelligence (DI)**: Es una disciplina que aplica modelos matemáticos, ciencia de datos e Inteligencia Artificial para modelar la toma de decisiones, estimando los resultados e implicaciones de múltiples opciones de acción antes de ejecutarlas, optimizando los resultados comerciales.

### ¿Por qué Analytics debe estar completamente desacoplado del dominio?
Ejecutar agregaciones analíticas complejas (ej: calcular el valor de vida del cliente [LTV] histórico de los últimos 5 años) directamente sobre la base de datos transaccional (DynamoDB - ADR-002) degrada severamente el rendimiento y eleva exponencialmente los costos por lectura. Al desacoplar la analítica mediante un pipeline de datos asíncrono, protegemos las operaciones OLTP y estructuramos la información bajo un modelo OLAP optimizado para agregaciones de datos masivos.

### ¿Por qué basar las decisiones del negocio en eventos?
Las bases de datos relacionales tradicionales solo capturan la "foto del estado actual" (ej. stock = 0). Basar la analítica en eventos (Event-Driven Analytics) nos permite capturar la secuencia cronológica completa de comportamientos del usuario (ej: el cliente visualizó el zapato 5 veces, lo añadió al carrito, lo removió por precio, volvió 2 días después ante un cupón y compró), revelando patrones semánticos imposibles de inferir mediante datos estáticos.

---

## CAPÍTULO 2: Arquitectura General del Data Pipeline

El flujo de procesamiento, almacenamiento y visualización analítica sigue la siguiente topología Serverless:

```
[Eventos de Dominio]
       │
       ▼ (Publicados al Bus)
[EventBridge Custom Bus]
       │
       ▼ (EventBridge Routing Rule)
[Kinesis Data Firehose]
       │
       ▼ (Conversión a Parquet en Caliente)
[Amazon S3: Raw Data Lake Bucket]
       │
       ├──> [AWS Glue Catalog & Crawlers] (Mapea esquemas de tablas)
       └──> [Amazon Athena] (Queries SQL interactivas en caliente)
       │
       ▼ (ETL Glue Job Batch)
[Amazon Redshift Serverless (Data Warehouse)]
       │
       ├──> [Amazon QuickSight] ──> Dashboards Gerenciales & Reportes
       └──> [Amazon Bedrock] ─────> Decision Intelligence, Forecasting & Insights
```

---

## CAPÍTULO 3: Modelo de Dominio Analítico

Modelamos 18 entidades para gobernar las métricas y los flujos de decisión del sistema:

1. **ANALYTICS_EVENT**: Representación plana de un click, impresión o interacción de usuario.
2. **KPI (Key Performance Indicator)**: Indicadores de alto nivel del negocio (LTV, CAC, Churn).
3. **METRIC**: Unidades de medida computadas de forma regular (ej: visitas por hora).
4. **DASHBOARD**: Visualización consolidada de KPIs asignada a una audiencia corporativa.
5. **REPORT**: Extracto o reporte tabular periódico enviado de forma automática.
6. **DATASET**: Consulta estructurada o vista indexada expuesta para visualizaciones.
7. **SEGMENT**: Agrupación dinámica de clientes que comparten comportamientos o atributos.
8. **FUNNEL**: Mapeo secuencial de pasos definidos para medir tasas de conversión de usuario.
9. **COHORT**: Grupo de usuarios que comparten un evento común (ej: mes de registro) analizados en el tiempo.
10. **EXPERIMENT**: Pruebas controladas (A/B testing, pruebas multivariables).
11. **AUDIENCE**: Lista de destinatarios objetivo para campañas basada en segmentación.
12. **FORECAST**: Predicciones temporales estimadas por algoritmos predictivos.
13. **ALERT**: Notificaciones inmediatas gatilladas cuando una métrica infringe límites de desvío.
14. **INSIGHT**: Descubrimiento descriptivo y recomendaciones inferidas por Bedrock.
15. **BUSINESS_RULE**: Reglas y umbrales lógicos configurables (ej: "CAC máximo tolerado = $15").
16. **GOAL**: Metas corporativas definidas (ej: "Aumentar AOV un 10% este trimestre").
17. **SCORECARD**: Balance de cumplimiento global por departamento.
18. **DATA_QUALITY_RULE**: Reglas de validación para asegurar la integridad de la ingesta (ej: "Eventos sin userId son rechazados").

---

## CAPÍTULO 4: Estructura del Data Lake (Amazon S3)

Diseñamos una arquitectura de lago de datos optimizada en costos y lectura:

- **Estructura de Buckets**:
  - `s3://commerceos-analytics-raw-${stage}/` (Datos crudos en formato JSON tal como llegan del bus).
  - `s3://commerceos-analytics-processed-${stage}/` (Datos convertidos a Parquet comprimido con Snappy, listos para consultas rápidas).
- **Esquema de Particionado (Hive-style)**:
  `s3://.../processed/event_name=PRODUCT_VIEWED/year=2026/month=07/day=15/hour=18/`
  Este particionado por evento, año, mes, día y hora permite a Athena omitir el escaneo de terabytes de datos innecesarios, limitando las lecturas a las particiones específicas de la consulta SQL.
- **Formato Apache Parquet**: Formato de almacenamiento columnar que reduce el espacio en disco hasta en un 85% y acelera las consultas de Athena hasta 10 veces frente a archivos JSON crudos.

---

## CAPÍTULO 5: Data Warehouse (Amazon Redshift Serverless)

Para reportes corporativos multidimensionales de alto desempeño que cruzan datos de facturación con CRM y marketing, implementamos **Modelado Dimensional (Star Schema)**:

```
                  ┌──────────────────────┐
                  │    Dim_Customers     │
                  └──────────┬───────────┘
                             │
     ┌───────────────────────┼───────────────────────┐
     ▼                       ▼                       ▼
┌──────────────┐    ┌─────────────────┐    ┌──────────────────┐
│  Dim_Product │ ──>│   Fact_Sales    │<── │    Dim_Dates     │
└──────────────┘    └─────────────────┘    └──────────────────┘
                             ▲
                             │
                  ┌──────────┴───────────┐
                  │     Dim_Channels     │
                  └──────────────────────┘
```

- **Fact Tables (Tablas de Hechos)**:
  - `fact_sales`: Registra transacciones monetarias de órdenes, comisiones, cupones y devoluciones.
  - `fact_sessions`: Registra visitas de clientes, fuentes UTM, dispositivos y conversiones.
- **Dimensions (Dimensiones)**:
  - `dim_products`: Atributos de variantes, marca, categorías e historial de precios.
  - `dim_customers`: Perfil del cliente, demografía, segmento y fecha de registro.
  - `dim_dates`: Jerarquía de tiempo (día, semana, mes, trimestre, año, feriados).

---

## CAPÍTULO 6: Registro de Eventos Analíticos

Los eventos analíticos se emiten asíncronamente ante interacciones del cliente:

### 1. **`ANALYTICS.PRODUCT_VIEWED`**
- *Publisher*: `Frontend Web Client`
- *Consumidores*: `Kinesis Ingestion Stream`, `Real-time Personalization Engine` (Prioridad: Baja)
- *Payload*: `{ "productId": "prd_777", "userId": "usr_999", "price": 99.90, "sessionToken": "sess_888" }`
- *Retención*: 180 días en Data Lake frío.

### 2. **`ANALYTICS.CHECKOUT_STARTED`**
- *Publisher*: `Checkout BFF`
- *Consumidores*: `Kinesis Ingestion Stream`, `Abandoned Cart Tracker` (Prioridad: Media)

### 3. **`ANALYTICS.PAYMENT_FAILED`**
- *Publisher*: `Integration Gateway (Stripe Adapter)`
- *Consumidores*: `Security Audit Engine`, `Notification Hub` (Prioridad: Alta)

---

## CAPÍTULO 7: Diccionario de KPIs Clave del Negocio

Definimos las fórmulas analíticas de las métricas principales del sistema:

- **Customer Lifetime Value (LTV)**:
  $$LTV = \text{Ticket Promedio (AOV)} \times \text{Frecuencia de Compra} \times \text{Tiempo de Retención Medio del Cliente}$$
- **Customer Acquisition Cost (CAC)**:
  $$CAC = \frac{\text{Inversión Total en Marketing y Ventas}}{\text{Número de Nuevos Clientes Adquiridos}}$$
- **Return on Ad Spend (ROAS)**:
  $$ROAS = \frac{\text{Ingresos Totales Atribuidos a Campañas Publicitarias}}{\text{Gasto Total en Publicidad (Ad Spend)}}$$
- **Tasa de Abandono del Carrito (Cart Abandonment Rate)**:
  $$\text{Abandonment Rate} = 1 - \left( \frac{\text{Checkouts Completados (Pago Exitoso)}}{\text{Carritos Creados con Items}} \right) \times 100$$

---

## CAPÍTULO 8: Topología de Dashboards por Rol Corporativo

QuickSight expone vistas personalizadas según el perfil del usuario autenticado (Cognito RBAC - ADR-005):

- **Dashboard CEO / General**:
  - *Métricas*: MRR, LTV, CAC, Margen Neto, Crecimiento Anual, NPS Global.
  - *Frecuencia*: Diaria / Consolidado Mensual.
- **Dashboard Marketing**:
  - *Métricas*: ROAS, CTR de banners, conversiones por canal UTM, atribución de campañas.
  - *Visualizaciones*: Mapas geográficos de compras, diagramas de embudo y rendimiento de cupones.
- **Dashboard Operaciones / Logística**:
  - *Métricas*: Tiempo promedio de entrega (Last Mile Delivery Time), tasa de devoluciones, rotación de inventario y porcentaje de pedidos despachados a tiempo.

---

## CAPÍTULO 9: Segmentación Dinámica de Clientes

Implementamos segmentación en base a comportamiento recalculada diariamente:

- **Clientes VIP**: Clientes con un LTV en el percentil superior del 5% y frecuencia de compra mayor a 3 veces al mes.
- **Clientes en Riesgo de Churn (Inactivos)**: Compradores históricos cuya última orden de compra exceda las 3 desviaciones estándar del tiempo promedio entre compras del inquilino SaaS.
- **Segmentación Geográfica e Interés**: Agrupación automatizada según ciudades de envío recurrentes y afinidad por categorías específicas (ej. compradores recurrentes de la categoría "Running").

---

## CAPÍTULO 10: Embudos de Conversión Comercial (Funnels)

El sistema modela y traza la pérdida de usuarios en las fases clave:

```
[1. CMS / Home View] ──(Pérdida 40%)──> [2. Product Details View]
                                                │
                                                ▼ (Pérdida 30%)
                                      [3. Add to Cart]
                                                │
                                                ▼ (Pérdida 50%)
                                      [4. Checkout Initiated]
                                                │
                                                ▼ (Pérdida 15%)
                                      [5. Payment Succeeded]
                                                │
                                                ▼ (Re-inyección 20%)
                                      [6. Repeat Purchase (Recompra)]
```

- **Mapeo de Pérdida de Contacto**: Si la pérdida entre el paso 4 y 5 excede el 60% en un periodo de 1 hora, se emite una alerta analítica automática al panel técnico ante posibles fallas de la pasarela de pagos.

---

## CAPÍTULO 11: Algoritmos de Predicción y Forecasting

Implementamos modelos predictivos de series de tiempo entrenados periódicamente:

- **Demand Forecasting**: Estimación de la demanda de stock de productos por SKU para los próximos 30 días, evitando sobre-stock o quiebres de inventario en bodega.
- **Churn Prediction**: Modelos predictivos que evalúan el comportamiento de visitas del cliente. Si detectan que un cliente frecuente deja de iniciar sesión o disminuye su CTR, alertan al CRM para despachar un cupón de reenganche automatizado.

---

## CAPÍTULO 12: Integración de Decision Intelligence con Amazon Bedrock

AWS Bedrock (modelo Claude 3.5 Sonnet) actúa como el consultor analítico en caliente de CommerceOS:

- **Generación de Insights en Lenguaje Natural**: Traduce gráficas complejas a explicaciones legibles (ej: "Tus ventas de calzado deportivo en Bogotá subieron 23% debido a la campaña de email del lunes; sin embargo, tu ROAS en Facebook Ads bajó un 12%").
- **Detección de Anomalías e Inteligencia Operativa**: Identifica desviaciones estadísticas inexplicables (anomalías) en el volumen de ventas por hora y sugiere soluciones inmediatas (ej: "Detectamos una caída inusual de compras en la categoría Calzado. La causa podría ser que el banner principal en la landing móvil está roto").

---

## CAPÍTULO 13: Centro de Alertas Inteligentes de Métricas

- **Alertas de Umbral Fijo**: Disparadas cuando un valor cruza límites críticos (ej: tasa de rebote de correos > 2%).
- **Alertas de Anomalía Estadística**: Basadas en desviación estándar. El sistema calcula la media móvil de conversión horaria. Si el valor real cae por debajo de `3 sigma` (3 desviaciones estándar) de la media esperada para ese día y hora, se emite una alerta crítica de "Posible Caída del Checkout".

---

## CAPÍTULO 14: Experimentación y Pruebas A/B

- **A/B Testing Engine**: El sistema puede dirigir porcentajes de tráfico configurables (ej: 50% al layout A y 50% al layout B) controlando la experiencia a través del API Gateway y evaluando la tasa de conversión final de cada variante.
- **Significancia Estadística**: El motor analítico calcula el valor P (*P-Value*) de la tasa de conversión del experimento. Si `P-Value < 0.05`, se declara ganador a la variante superior y se consolida como layout por defecto automáticamente.

---

## CAPÍTULO 15: Seguridad, Privacidad y Gobierno de Datos (ADR-005)

- **Anonimización y Enmascaramiento de Datos (PII Protection)**:
  - Información Personal Identificable (ej: nombres, correos, números de teléfono, direcciones exactas de clientes) se enmascaran en el Data Lake (ej: convirtiendo `juan.perez@email.com` a `j***z@email.com` o aplicando hashes SHA-256 de un solo sentido).
  - Los analistas de BI tienen permisos de lectura únicamente sobre datos demográficos anonimizados.
- **Row-Level Security (RLS) en QuickSight**: Permite que un distribuidor local de CommerceOS solo visualice reportes e ingresos financieros asociados estrictamente a su ID de sucursal o región geográfica.

---

## CAPÍTULO 16: Observabilidad del Data Pipeline

Monitoreamos la consistencia y salud de las ingestas analíticas:

- **Athena Query Optimization Alarms**: Alarmas si una consulta individual de Athena escanea más de 100GB de datos, sugiriendo fallas en las particiones o indexación del catálogo de Glue.
- **Data Quality Rules**: AWS Glue Data Quality evalúa la integridad estructural de los esquemas entrantes (ej: rechazar inserciones al Data Lake si faltan propiedades obligatorias de auditoría).

---

## CAPÍTULO 17: Escalabilidad de Datos a Escala Masiva

- **Parquet Compressing & Buffering**: Kinesis Data Firehose realiza el agrupamiento de eventos en batches de 5MB o periodos de espera de 60 segundos antes de realizar la escritura columnar en S3. Esto evita el problema de los "archivos pequeños" (*small files problem*) en S3, que degrada el rendimiento de lectura de Athena y Glue.
- **Redshift Serverless Autoscaling**: El almacén se autoescala añadiendo unidades de procesamiento de Redshift (RPUs) durante picos de consultas complejas del cierre contable de fin de mes, reduciendo costos al mínimo en horarios de baja demanda.

---

## CAPÍTULO 18: Roadmap de Implementación Analítica

- **Fase 1: Ingesta Transaccional y KPIs**: Configuración de Kinesis Firehose, Data Lake S3 y Glue Catalog. Mapeo de eventos críticos (`ORDER_PAID`, `SESSION_STARTED`).
- **Fase 2: Visualizaciones y Dashboards**: Despliegue de Amazon Redshift Serverless y dashboards interactivos básicos en Amazon QuickSight para Finanzas y Operaciones.
- **Fase 3: Segmentación y Embudos**: Implementación de segmentación automatizada de clientes y embudos dinámicos en la consola.
- **Fase 4: Modelos Predictivos y Demand Forecasting**: Integración de tareas de Machine Learning para estimar inventario y ventas mensuales.
- **Fase 5: AI Insights & Bedrock**: Consultor analítico interactivo con Bedrock en el panel administrativo.
- **Fase 6: Toma de Decisiones Autónoma**: Integración bidireccional donde la IA no solo sugiere, sino que propone y ejecuta flujos del Automation Framework (ADR-009) de forma controlada ante eventos.

---

## CAPÍTULO 19: Checklist Analítico para Nuevas Funcionalidades

Toda nueva entidad o funcionalidad comercial integrada a la plataforma debe certificar el cumplimiento de este checklist analítico:

- [ ] **Declaración de Eventos**: Define y registra qué eventos analíticos emite la funcionalidad ante interacciones del usuario.
- [ ] **Mapeo de KPIs**: Especifica qué indicadores clave se ven alterados o medidos con la introducción de la nueva funcionalidad.
- [ ] **Protección PII**: Toda variable confidencial o de identificación personal se enmascara antes de ser enviada al Data Lake.
- [ ] **Integración en el Catálogo de Glue**: El esquema del payload está registrado y es compatible con el catálogo relacional analítico.
