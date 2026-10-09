# ARCHITECTURE DECISION RECORD (ADR-007)
## ENTERPRISE SEARCH & DISCOVERY FRAMEWORK

**Estado:** APROBADO  
**Contexto:** Arquitectura e Ingeniería de Búsqueda, Indexación y Descubrimiento Enterprise  
**Arquitecto:** Principal Search Architect (Especialista en OpenSearch, Lucene & Hybrid Search)  
**Versión:** 1.0.0  

---

## CAPÍTULO 1: Filosofía del Framework

### ¿Qué es Enterprise Search?
Enterprise Search es la práctica de indexar de forma agregada, comprensible y sumamente rápida la información contenida en las múltiples bases de datos de una corporación, facilitando su consumo mediante búsquedas libres de texto, filtrados dinámicos y correlaciones semánticas.

### ¿Por qué no consultar DynamoDB directamente?
DynamoDB es una excelente base de datos OLTP (Online Transaction Processing) transaccional optimizada para lecturas de clave-valor puntuales (`GetItem`) y listados estructurados rápidos (`Query`). Sin embargo:
1. **Ineficiencia en Búsqueda Libre**: Realizar búsquedas de texto parcial (ej: encontrar productos que contengan "zapatilla running roja") obligaría a realizar operaciones `Scan` extremadamente costosas que consumirían unidades de lectura (RCUs) y ralentizarían la base de datos principal.
2. **Ausencia de Relevancia (Scoring)**: DynamoDB no posee algoritmos para medir qué tan relevante es un resultado (como BM25 o vector cosino) ni soporta sinónimos o errores ortográficos nativamente.
3. **Agregaciones Limitadas**: Calcular conteos dinámicos por facetas en tiempo real (ej. cuántos productos hay de cada talla y precio) requeriría descargar todo el catálogo y computarlo en la Lambda, degradando la escalabilidad del sistema.

### ¿Por qué desacoplar búsqueda del modelo transaccional?
Adoptamos una separación de responsabilidades estricta siguiendo el patrón **CQRS (Command Query Responsibility Segregation)**:
- **Capa de Escritura (Persistencia Transaccional)**: DynamoDB gestiona las operaciones de escritura y las invariantes del negocio síncronamente.
- **Capa de Lectura y Descubrimiento (Búsqueda)**: Amazon OpenSearch gestiona la indexación de lectura de forma asíncrona, desahogando por completo a la base de datos OLTP.

---

## CAPÍTULO 2: Arquitectura General del Ingestion Pipeline

Establecemos que **ninguna Lambda del dominio puede realizar llamadas directas de indexación (Index / Bulk) hacia OpenSearch**. Toda indexación debe ocurrir como reacción asíncrona a eventos propagados por el bus de integración, garantizando resiliencia y desacoplamiento absoluto:

```
[Operación de Escritura] 
       │
       ▼
[DynamoDB Single Table] ──(Stream CDC)──> [Streams Forwarder Lambda]
                                                │
                                                ▼ (Emitido al Bus)
                                      [EventBridge Custom Bus]
                                                │
                                                ▼ (Reglas JSON)
                                      [SQS Indexer Queue]
                                                │
                                                ▼ (Consumo en Batch)
                                      [Indexer Lambda Worker]
                                                │
                                                ▼ (Bulk Operations)
                                      [Amazon OpenSearch Cluster]
```

### Flujo de Consulta:
```
[Cliente: Frontend] ──> [API Gateway / CORS] ──> [Search Lambda] ──> [OpenSearch Cluster]
```
1. **Search Lambda**: Expone un BFF (Backend for Frontend) que valida las cabeceras de seguridad de Cognito (ADR-005) y ejecuta consultas complejas de búsqueda, agregación de facetas y autocompletado en milisegundos.

---

## CAPÍTULO 3: Dominios Indexables (Estrategia de Múltiples Índices)

Para evitar un índice único saturado que degrade el rendimiento del cluster, CommerceOS utiliza una topología multitenant segregada en los siguientes índices lógicos:

1. **`commerceos-products-${tenantId}`**: Indexa el catálogo de productos con variantes, precios, inventario y SEO.
2. **`commerceos-categories-${tenantId}`**: Indexa categorías y sus rutas materializadas en el árbol.
3. **`commerceos-brands-${tenantId}`**: Catálogo de marcas registradas.
4. **`commerceos-collections-${tenantId}`**: Agrupaciones comerciales activas.
5. **`commerceos-seasons-${tenantId}`**: Temporadas de venta.
6. **`commerceos-customers-${tenantId}`**: Datos del CRM de clientes (nombre, email, segmento) protegidos bajo cifrado fino.
7. **`commerceos-orders-${tenantId}`**: Historial de órdenes para análisis de compra e historial administrativo.
8. **`commerceos-cms-${tenantId}`**: Páginas de CMS, landings y artículos del blog.
9. **`commerceos-media-${tenantId}`**: Índice del DAM (Digital Asset Management) con OCR y etiquetas de IA (ADR-006).
10. **`commerceos-reviews-${tenantId}`**: Reseñas y valoraciones de productos.
11. **`commerceos-tickets-${tenantId}` & `commerceos-chats-${tenantId}`**: Historial de soporte técnico e interacciones.
12. **`commerceos-promotions-${tenantId}`**: Cupones de descuento y tarjetas de regalo.

---

## CAPÍTULO 4: Modelo de Documento Estructurado

Cada documento en OpenSearch almacena un reflejo desnormalizado del agregado del dominio diseñado para optimizar lecturas, incluyendo metadatos de trazabilidad e integridad:

```json
{
  "_id": "prd_3GYla1TV1r0rN02KW36",
  "tenantId": "tenant_111",
  "entity": "Product",
  "name": "Zapatilla Running Nike Air",
  "description": "Zapatilla premium diseñada para maratones con suela de fibra de carbono.",
  "slug": "zapatilla-running-nike-air",
  "brand": {
    "id": "brnd_999",
    "name": "Nike"
  },
  "categories": [
    { "id": "cat_123", "name": "Calzado" },
    { "id": "cat_456", "name": "Running" }
  ],
  "variants": [
    { "sku": "NK-AIR-RED-42", "color": "Rojo", "size": "42", "price": 129.99, "stock": 15 }
  ],
  "status": "PUBLISHED",
  "isDeleted": false,
  "version": 3,
  "traceId": "ba5e1cca-2778-46bc-99f4-988979997e2b",
  "correlationId": "6bd0ef27a7a9c75f",
  "indexedAt": "2026-07-15T23:01:05.143Z"
}
```

### Campos de Control de Integridad:
- **`isDeleted`**: Indicador booleano que permite filtrado inmediato de borrados lógicos sin eliminar físicamente el documento (Soft Delete).
- **`version`**: Utilizado para control de concurrencia optimista, previniendo sobreescrituras desordenadas si un evento antiguo llega con retraso al indexador.
- **`traceId`**: Conserva la traza del API Gateway para correlación de errores.

---

## CAPÍTULO 5: Pipeline de Indexación y Reindexación

### Sincronización y Indexación SQS Batch:
- La cola SQS alimenta la Lambda Indexadora en batches de hasta 100 registros.
- La Lambda utiliza la API de indexación masiva (`Bulk API`) de OpenSearch para reducir los tiempos de viaje de red y amortiguar el consumo de CPU en el cluster.

### Estrategia de Reindexación sin Downtime (Blue-Green Indexing):
Cuando evoluciona el mapeo del esquema de OpenSearch, aplicamos el patrón **Index Aliasing**:
1. El alias público `commerceos-products-active` apunta actualmente al índice físico `commerceos-products-v1`.
2. Creamos un nuevo índice físico `commerceos-products-v2` con el nuevo mapping.
3. El indexador procesa de forma masiva (Bulk) leyendo del Data Lake de S3 o DynamoDB los registros históricos y los escribe en `v2`.
4. Mediante una transacción atómica de OpenSearch, el alias `commerceos-products-active` se desasocia de `v1` y se asocia a `v2`.
5. Se elimina `v1` una vez validada la consistencia de búsquedas.

---

## CAPÍTULO 6: Búsqueda por Facetas Dinámicas (Faceted Search)

Para calcular la cantidad de productos por atributos dinámicos en tiempo real sin degradar el rendimiento, utilizamos agregaciones anidadas (`Aggregations`) de OpenSearch:

- **Precio**: Agregaciones por rangos (`Range Aggregation`) dinámicos calculando mínimos, máximos e histogramas de distribución.
- **Atributos de Variante**: Agregaciones de términos (`Terms Aggregation`) sobre atributos clave indexados en formato plano:
  - `variants.color`
  - `variants.size`
  - `brand.name`
  - `categories.name`
- **Agregaciones Filtradas**: Para mantener contadores actualizados mientras el usuario activa múltiples filtros simultáneamente, aplicamos la técnica de agregación de filtros alternos (`Post-Filter`), evitando recalculaciones redundantes en la interfaz de usuario.

---

## CAPÍTULO 7: Autocompletado y Búsqueda Predictiva

Para una experiencia de búsqueda instantánea de clase mundial, implementamos:

- **Search-As-You-Type**: Uso de analizadores de N-Gramos (`Edge N-Grams`) que descomponen palabras a nivel de prefijo en tiempo de indexación (ej. indexar "nike" genera tokens "n", "ni", "nik", "nike"). Permite encontrar resultados con tan solo escribir las primeras letras.
- **Sugerencias y Términos Populares**: Consultas basadas en agregaciones de términos de búsquedas históricas frecuentes guardadas en el índice de analíticas de búsqueda.
- **Corrección Ortográfica y Tolerancia a Fallos (Typos)**: Consultas de coincidencia difusa (`Fuzzy Query`) con una distancia de Levenshtein máxima configurable de 2 para admitir errores de tipeo ligeros (ej. "Zpatos" encuentra "Zapatos").
- **Análisis Lingüístico**: Aplicación de listas integradas de palabras vacías (`Stop Words` como "el", "de", "con"), algoritmos de lematización/pluralización y mapas de sinónimos actualizados en caliente (ej: "celular" mapea a "móvil" y "teléfono").

---

## CAPÍTULO 8: Algoritmo de Ranking y Relevancia (Scoring)

Adoptamos la fórmula probabilística **BM25** como núcleo de coincidencia de texto, pero la multiplicamos dinámicamente mediante modificadores funcionales de negocio (`Function Score Query`):

$$\text{Final Score} = \text{Text Match Score (BM25)} \times \left( w_1 \cdot \text{Popularidad} + w_2 \cdot \text{Ventas} + w_3 \cdot \text{CTR} - w_4 \cdot \text{Falta de Inventario} \right)$$

### Ponderaciones del Ranking de Búsqueda:
- **Disponibilidad de Inventario**: Productos sin stock activo en variantes se penalizan multiplicando su puntaje por `0.1`, hundiéndolos al final de los resultados.
- **Velocidad de Conversión e Historial Comercial**: SKU con alto volumen de ventas en los últimos 7 días y alto CTR (Click-Through Rate) reciben un aumento de peso del 15% (`boost`).
- **Promoción Forzada**: Atributos específicos del panel administrativo (ej. campañas destacadas) pueden forzar un aumento directo del score para priorizar productos patrocinados en las primeras posiciones.

---

## CAPÍTULO 9: Búsqueda Semántica e Integración con IA

Para ir más allá de la simple coincidencia de palabras clave, CommerceOS implementa **Hybrid Search**:

```
[Query del Usuario]
       │
       ├──> [Analizador Tradicional Keyword Match (BM25)] ───────────┐
       │                                                             ▼
       └──> [Genera Embeddings con Bedrock Titan] ──> [k-NN Query] ──> [RRF (Reciprocal Rank Fusion)] ──> [Resultados]
```

### Componentes de Búsqueda Semántica:
- **Embeddings de Texto**: Usamos **Amazon Bedrock** (modelo `Amazon Titan Text Embeddings`) para vectorizar la query del usuario en un vector de alta dimensionalidad.
- **Búsqueda Vectorial K-NN**: Ejecución de consultas de vecinos más cercanos (*k-NN*) en OpenSearch para buscar correspondencia semántica (ej: buscar "calzado cómodo para lluvia" encuentra botas impermeables sin coincidencia de palabras clave exactas).
- **Reciprocal Rank Fusion (RRF)**: Algoritmo que fusiona matemáticamente las listas de resultados de la búsqueda tradicional de palabras clave con los resultados vectoriales de la búsqueda semántica, garantizando la mayor relevancia de visualización del mercado.

---

## CAPÍTULO 10: Búsqueda en el Media Library (DAM Integration)

El índice `commerceos-media` integra la analítica visual y de documentos de forma nativa:

- **Indexación OCR**: Guarda fragmentos de texto completos extraídos de imágenes o documentos PDF analizados por Textract.
- **AI Tags & Object Detection**: Permite la localización rápida de imágenes mediante búsquedas de conceptos de Rekognition (ej: buscar "playa" encuentra fotos de modelos en bikini o trajes de baño).
- **Paleta de Colores**: Indexación de colores en formato hexadecimal de-normalizado a nombres base (rojo, verde, azul) para búsquedas de marcas específicas.

---

## CAPÍTULO 11: Búsqueda en el Sistema CMS

El índice `commerceos-cms` unifica contenidos dinámicos de landings y blogs:

- **Estructura de Bloques**: Almacena bloques estructurados y texto interno de los widgets del CMS Elementor-style, omitiendo el marcado HTML para evitar ruido de indexación.
- **Campos SEO**: Los campos de título de página, meta descripciones y etiquetas URL son priorizados sobre el cuerpo de texto en la configuración de relevancia.

---

## CAPÍTULO 12: Barra de Búsqueda Administrativa Global (Omnibox)

El panel administrativo expone una única barra de búsqueda de alto desempeño que realiza búsquedas multitarea:

- **Consultas Multi-Índice en Paralelo**: La barra de búsqueda ejecuta consultas asíncronas sobre múltiples índices de forma paralela (`Multi-Search API`).
- **Enrutamiento Inteligente**: Si la entrada de usuario coincide con un patrón KSUID específico, la consola se anticipa (ej: patrón `ord_...` redirige directamente a la ficha del pedido; patrón `med_...` abre la previsualización del DAM; entrada de email busca cuentas de clientes del CRM).

---

## CAPÍTULO 13: Métricas de Búsqueda y Discovery Analytics

Toda ejecución de consulta y conversión de búsqueda se registra en un pipeline dedicado:

- **Métricas de Rendimiento**: Registro del tiempo de respuesta del cluster (`took`), latencias de red y tasas de consultas lentas (`Slow Queries`).
- **Búsquedas sin Resultados (Zero Results Logs)**: Reportes diarios sobre qué términos escribieron los clientes que retornaron 0 coincidencias, alimentando la estrategia de campañas de marketing e inventario.
- **Seguimiento del Abandono**: Analíticas que miden si el usuario hizo clic en las primeras posiciones o si abandonó la búsqueda, retroalimentando dinámicamente los pesos del ranking inteligente de Bedrock.

---

## CAPÍTULO 14: Catálogo de Eventos del Dominio de Búsqueda

Definimos los eventos del framework de búsqueda indexados en el bus de EventBridge:

### 1. **`SEARCH.INDEX_CREATED`**
- *Publisher*: `Search Orchestrator`
- *Payload*: `{ "indexName": "commerceos-products-v2", "createdAt": "2026-07-15T23:01:05Z" }`
- *Prioridad*: Baja

### 2. **`SEARCH.DOCUMENT_INDEXED`**
- *Publisher*: `Search Indexer Worker`
- *Payload*: `{ "documentId": "prd_999", "index": "commerceos-products-dev", "version": 2 }`
- *Prioridad*: Media

### 3. **`SEARCH.QUERY_EXECUTED`**
- *Publisher*: `Search API BFF`
- *Payload*: `{ "queryText": "carbon shoes", "tookMs": 14, "resultsCount": 120 }`
- *Prioridad*: Baja

### 4. **`SEARCH.NO_RESULTS`**
- *Publisher*: `Search API BFF`
- *Payload*: `{ "queryText": "xyz-invalid-product", "ipAddress": "186.22.1.2" }`
- *Prioridad*: Media

---

## CAPÍTULO 15: Estrategia de Seguridad del Índice de Búsqueda

Alineamos OpenSearch con las reglas del ADR-005:

- **Aislamiento Multitenant**: El API Gateway valida que el `tenantId` inyectado en el JWT coincida estrictamente con los prefijos del índice en OpenSearch, imposibilitando fugas de datos entre organizaciones.
- **Fine-Grained Access Control (FGAC)**: Reglas de seguridad basadas en roles (SAML/IAM) aplicadas a nivel de índice de OpenSearch. Las Lambdas de clientes solo tienen permisos de lectura (`ReadOnly`) en índices comerciales, mientras que el rol del indexador asíncrono tiene permisos de escritura restringidos a la cola SQS de indexación.
- **Document-Level Security (DLS)**: Clientes externos no pueden visualizar documentos marcados con atributos confidenciales o cuyo estado no sea `PUBLISHED`.

---

## CAPÍTULO 16: Observabilidad y Alarmas del Cluster

Monitoreamos el estado de salud del motor de búsqueda:

- **Latencia de Búsqueda (Search Latency)**: Alarma de nivel crítico si la latencia promedio supera los 50ms durante un lapso continuo de 3 minutos.
- **Slow Query Logs**: Consultas que requieran más de 100ms se guardan en un log dedicado de CloudWatch para revisión del equipo de ingeniería de relevancia.
- **JVM Memory Pressure**: Alerta temprana si la presión de la memoria del cluster supera el 85%, iniciando procesos automatizados de escalamiento horizontal (añadir nodos adicionales al dominio).

---

## CAPÍTULO 17: Escalabilidad de Carga y Optimización de Costos

### Soportar +100 Millones de Documentos:
- **Sharding & Replication**: Configuración de particionado elástico. El catálogo de productos de alto tráfico se particiona en múltiples shards primarios y réplicas cruzadas geográficamente para garantizar alta velocidad y tolerancia a fallos ante fallas físicas de hardware de AWS.
- **Bulk Queueing**: Enrutamiento amortiguado a través de colas SQS antes de invocar a OpenSearch, previniendo cuellos de botella por exceso de indexaciones concurrentes en Black Friday.
- **Cost Management**:
  - Uso de nodos UltraWarm en AWS OpenSearch. Documentos históricos e índices fríos (ej: logs de chats o facturas de compras de años pasados) se migran automáticamente de nodos de almacenamiento ultra rápidos en SSD a almacenamiento persistente en S3 más económico de solo lectura.

---

## CAPÍTULO 18: Checklist de Calidad para Indexación

Antes de habilitar búsquedas para cualquier módulo o entidad del sistema en producción, esta debe pasar la siguiente lista de control:

- [ ] **Desacoplamiento de Escritura**: La Lambda de negocio no realiza llamadas HTTP de escritura directas a OpenSearch; emite un evento al bus de integración.
- [ ] **Mapeo de Control de Concurrencia**: El documento indexado incluye un campo `version` para validación de secuencia lógica de eventos.
- [ ] **Políticas Multitenant Claras**: Toda consulta inyecta obligatoriamente el filtro por prefijo `tenantId` para evitar exposición de datos ajenos.
- [ ] **Compresión y Facetas Optimizadas**: Campos que actúan como filtros dinámicos están mapeados con tipo de dato `keyword` (no de búsqueda de texto completo) para asegurar agregaciones rápidas.
- [ ] **Caché y TTL de Alias Activo**: El alias del índice apunta al índice físico correcto y ha sido validado bajo un plan de rollback.

---

## CAPÍTULO 19: Roadmap Evolutivo de Búsqueda y Discovery

Establecemos una estrategia de desarrollo en 6 fases independientes para minimizar la complejidad técnica del despliegue:

```
[Fase 1: Búsqueda Tradicional Keyword Match] 
                    │
                    ▼
[Fase 2: Facetas Dinámicas y Autocompletado Edge N-Gram]
                    │
                    ▼
[Fase 3: Algoritmo de Ranking BM25 + Ponderaciones de Negocio]
                    │
                    ▼
[Fase 4: Búsqueda Semántica Vectorial con Amazon Bedrock Titan]
                    │
                    ▼
[Fase 5: Personalización y Recomendaciones por Comportamiento de Sesión]
                    │
                    ▼
[Fase 6: Búsqueda Multimodal (Búsqueda por fotos / DAM visual)]
```
