# ARCHITECTURAL DECISION RECORD (ADR)
## ADR-002: Single Table Design & Access Patterns (Persistencia de Datos Enterprise)

**ID**: ADR-002  
**Título**: Single Table Design & Access Patterns para CommerceOS  
**Estado**: Aprobado  
**Contexto**: proStore Backend  
**Autor**: Principal Solutions Architect  

---

## CAPÍTULO 1: Filosofía del Modelo de Datos

Este capítulo define las bases fundamentales de nuestra estrategia de almacenamiento, justificando la selección de bases de datos NoSQL y el patrón de Tabla Única (Single Table Design) en el ecosistema de AWS.

### ¿Por qué DynamoDB?
Amazon DynamoDB es la base de datos nativa en la nube por excelencia de AWS para cargas de trabajo de alto rendimiento. Las razones críticas de su elección para un Commerce Operating System son:
1. **Rendimiento predecible a cualquier escala**: DynamoDB ofrece latencias de lectura y escritura de un solo dígito de milisegundo (single-digit millisecond latency), ya sea que la base de datos contenga 10,000 registros o 10,000 millones.
2. **Arquitectura Serverless Nativa**: Escala automáticamente la capacidad de lectura y escritura (RCU/WCU) para alinear las operaciones con los picos de tráfico (como el Black Friday) sin necesidad de intervención manual o reinicio de clusters.
3. **Integración con el Ecosistema Serverless**: Dispone de disparadores nativos (DynamoDB Streams) para arquitecturas orientadas a eventos y se integra perfectamente con las políticas de control de acceso de AWS IAM a nivel granular.

### ¿Por qué Single Table Design?
En las bases de datos relacionales tradicionales (SQL), se crean tablas separadas por cada entidad de negocio (usuarios, pedidos, productos) y se unifican mediante relaciones (`JOINs`). En sistemas hiper-escalables, los JOINs destruyen el rendimiento porque obligan al motor de base de datos a cruzar índices y leer múltiples sectores de disco al vuelo.

**Single Table Design** consiste en almacenar múltiples tipos de entidades en una sola tabla de DynamoDB. Las ventajas operativas son:
1. **Reducción de latencia de red**: En lugar de hacer una consulta para obtener un pedido, otra para el cliente y otra para los productos comprados (3 viajes de red), podemos recuperar todo el grafo de relaciones en una sola petición `Query` estructurando las llaves correctamente.
2. **Menos conexiones activas**: En arquitecturas serverless, miles de Lambdas concurrentes abren conexiones de base de datos. Una sola tabla significa optimizar el pool de conexiones HTTP/REST de forma drástica.
3. **Coste Eficiente**: Es más barato aprovisionar y monitorizar una sola tabla (y sus índices globales) en lugar de balancear decenas de tablas independientes en entornos Enterprise.

### ¿Por qué Event Driven?
CommerceOS is reactivo. La persistencia en DynamoDB no es el final de la transacción; es el disparador. Cuando un registro es guardado o modificado en DynamoDB, la capa de persistencia emite eventos a un Event Bus (EventBridge) o activa DynamoDB Streams. Esto permite que sub-sistemas de analítica, marketing, sincronización con almacenes físicos y pasarelas de pago reaccionen asíncronamente sin añadir latencia a la llamada HTTP principal.

### ¿Por qué Repository Pattern?
El patrón Repositorio aísla por completo la lógica de negocio (servicios) de los detalles de implementación de DynamoDB. Los servicios no conocen la existencia de llaves como `PK`, `SK`, `GSI1PK` ni la estructura polimórfica de la Single Table. El Repositorio expone métodos con firmas de negocio claras (ej: `getOrderById(id)`) y se encarga de mapear las entidades de dominio a ítems crudos de DynamoDB.

### ¿Por qué Access Patterns First?
En SQL, diseñas las tablas normalizadas y luego escribes las consultas que necesites. **En DynamoDB es al revés**. Si diseñas la tabla sin conocer los patrones de acceso exactos, terminarás realizando operaciones de escaneo masivo (`Scan`), lo cual eleva exponencialmente los costos financieros y degrada la latencia. Primero listamos cada consulta que el negocio requiere, y luego estructuramos las llaves primarias para satisfacerlas mediante operaciones eficientes de tipo `Query`.

### ¿Cuándo NO utilizar Single Table Design?
Single Table Design **no** debe utilizarse en:
- Sistemas de reportería ad-hoc o inteligencia de negocios (BI) donde los usuarios finales escriben consultas libres y dinámicas en tiempo de ejecución.
- Aplicaciones donde las reglas y relaciones de acceso a los datos son altamente impredecibles y cambian de forma constante.
- Proyectos muy pequeños donde el costo operativo de modelar en Single Table supera la simplicidad inicial de múltiples tablas.

### Trade-offs: Ventajas vs. Desventajas
- **Ventajas**: Escalabilidad teóricamente ilimitada, latencia ultra-baja y constante, costes operativos mínimos y automatización de TTL y eventos de flujo.
- **Desventajas**: Curva de aprendizaje empinada para desarrolladores acostumbrados a SQL, flexibilidad limitada para consultas no planificadas (requiere sincronización con OpenSearch para búsquedas analíticas complejas o texto libre) y complejidad de diseño inicial.

---

## CAPÍTULO 2: Principios de Diseño

Establecemos las reglas inquebrantables que todo desarrollador debe respetar al interactuar con la base de datos CommerceOS.

### Reglas Oficiales de Modelado
1. **Regla de Cero Scans**: Queda estrictamente prohibido utilizar la operación `Scan` de DynamoDB en entornos de producción. Todas las lecturas de listas deben resolverse mediante operaciones `Query` utilizando índices definidos.
2. **Esquema de Llaves Genérico**: Las columnas de llave primaria de la tabla física se llamarán únicamente `PK` (Partition Key) y `SK` (Sort Key) de tipo String. Nunca usar nombres específicos de entidad como `productId` o `orderId` como llaves físicas principales.
3. **Tamaño Máximo del Ítem**: Un ítem en DynamoDB no puede exceder los 400KB. Cualquier dato grande (ej: imágenes de productos, logs extendidos de chat) debe almacenarse en Amazon S3, persistiendo únicamente la URL de referencia en el ítem de DynamoDB.
4. **Mutación de Índices Secundarios**: Para campos opcionales que actúen como filtros, aprovechar la propiedad de *Sparse Index* (Índice Disperso) omitiendo el atributo del ítem para que DynamoDB no gaste almacenamiento en el índice de forma innecesaria.

### Anti-patrones y Errores Comunes
- **Unión por Aplicación (App-side JOINs masivos)**: Hacer un Query para obtener una lista de 50 pedidos y luego iterar en un bucle haciendo 50 Queries individuales para obtener los datos del cliente de cada uno. La relación debe estar pre-modelada o resuelta en un solo Query por colección.
- **Índices Secundarios Duplicados**: Crear un GSI por cada atributo que se quiera filtrar. Cada GSI incrementa el costo de las escrituras físicas. El límite máximo teórico es de 20 GSIs por tabla en DynamoDB; nuestro diseño se restringirá a un máximo de 3 GSIs genéricos polimórficos.
- **Falta de prefijos en las llaves**: Almacenar IDs puros sin prefijo (ej: `PK: usr_123` en lugar de `PK: USER#usr_123`). Los prefijos evitan colisiones accidentales entre diferentes entidades y permiten filtros limpios por tipo.

---

## CAPÍTULO 3: Mapa Completo de Entidades

A continuación se modela el mapa conceptual de dominios de la plataforma CommerceOS. Cada entidad tiene una responsabilidad específica y dependencias lógicas.

```
+------------------------------------------------------------------------+
|                             MAPA DE ENTIDADES                          |
+------------------------------------------------------------------------+
|                                                                        |
|  [USER] ──► [ROLE] ──► [PERMISSION]                                    |
|                                                                        |
|  [CUSTOMER] ──► [ADDRESS]                                              |
|                                                                        |
|  [CATEGORY] ──► [PRODUCT] ──► [PRODUCT_VARIANT] ──► [STOCK_MOVEMENT]   |
|                      │                                                 |
|                      ├──► [BRAND]                                      |
|                      ├──► [COLLECTION]                                 |
|                      └──► [REVIEW]                                     |
|                                                                        |
|  [ORDER] ──► [ORDER_ITEM] ──► [PAYMENT] ──► [SHIPMENT]                 |
|                                                                        |
|  [COUPON] / [PROMOTION] ──► [GIFT_CARD]                                |
|                                                                        |
|  [BLOG] / [CMS_PAGE] ──► [LANDING] ──► [SECTION]                       |
|                                                                        |
|  [CHAT] ──► [MESSAGE]                                                  |
|                                                                        |
+------------------------------------------------------------------------+
```

### Detalle de Responsabilidad y Relaciones

#### CATEGORY (Categoría)
- **Responsabilidad**: Estructurar la taxonomía de la tienda. Soporta anidación infinita (categorías padres e hijas).
- **Relaciones**: 1:N con categorías hijas, N:M con productos.
- **Dependencias**: Ninguna.

#### PRODUCT (Producto)
- **Responsabilidad**: Representar el catálogo comercial base. Contiene títulos, descripciones, estado y metadatos SEO.
- **Relaciones**: 1:N con variantes, N:M con categorías, 1:1 con marcas.
- **Dependencias**: Requiere de al menos una Categoría y una Marca.

#### PRODUCT_VARIANT (Variante de Producto)
- **Responsabilidad**: Especificar combinaciones físicas comercializables (talla, color, material, SKU específico, código de barras, precio diferenciado).
- **Relaciones**: N:1 con Producto, 1:N con Inventario y Movimientos de Stock.
- **Dependencias**: Producto Padre.

#### ATTRIBUTE & ATTRIBUTE_VALUE (Atributos y Valores)
- **Responsabilidad**: Definir propiedades dinámicas para filtrado (ej: Atributo: "Color", Valor: "Rojo").
- **Relaciones**: N:M con variantes de producto.
- **Dependencias**: Ninguna.

#### COLLECTION (Colección)
- **Responsabilidad**: Agrupar productos de forma transversal al árbol de categorías (ej: "Colección de Verano").
- **Relaciones**: N:M con productos.
- **Dependencias**: Ninguna.

#### BRAND (Marca)
- **Responsabilidad**: Identificar fabricantes o marcas de productos.
- **Relaciones**: 1:N con productos.
- **Dependencias**: Ninguna.

#### SEASON (Temporada)
- **Responsabilidad**: Agrupar productos por vigencia temporal (ej: "Temporada Invierno 2026").
- **Relaciones**: 1:N con productos.
- **Dependencias**: Ninguna.

#### USER, ROLE & PERMISSION (Usuarios del Panel, Roles y Permisos)
- **Responsabilidad**: Control de acceso de administradores, gestores y agentes de soporte de la plataforma.
- **Relaciones**: User 1:N Roles, Role N:M Permissions.
- **Dependencias**: Ninguna.

#### CUSTOMER (Cliente)
- **Responsabilidad**: Datos de perfil de los compradores (historial, carrito activo, configuración).
- **Relaciones**: 1:N con Direcciones, 1:N con Pedidos, 1:1 con Carrito de Compras.
- **Dependencias**: Registro directo o via Cognito.

#### ADDRESS (Dirección)
- **Responsabilidad**: Direcciones físicas de facturación y envío.
- **Relaciones**: N:1 con Cliente.
- **Dependencias**: Cliente Propietario.

#### ORDER (Pedido)
- **Responsabilidad**: Encabezado del documento transaccional de venta. Almacena totales, impuestos, estado y metadatos.
- **Relaciones**: 1:N con ítems del pedido (`ORDER_ITEM`), 1:N con transacciones de pago (`PAYMENT`), 1:1 con envíos (`SHIPMENT`).
- **Dependencias**: Cliente y Carrito origen.

#### ORDER_ITEM (Ítem de Pedido)
- **Responsabilidad**: Detalle del producto comprado en una orden específica, congelando el precio histórico y cantidad.
- **Relaciones**: N:1 con Pedido, 1:1 con Variante de Producto.
- **Dependencias**: Pedido Padre.

#### PAYMENT (Pago)
- **Responsabilidad**: Registrar transacciones monetarias asociadas a un pedido (pasarela, referencia, estado del cobro).
- **Relaciones**: N:1 con Pedido.
- **Dependencias**: Pedido Asociado.

#### SHIPMENT (Envío)
- **Responsabilidad**: Gestionar la logística de entrega física del pedido (transportadora, número de guía, estado del tránsito).
- **Relaciones**: 1:1 con Pedido.
- **Dependencias**: Pedido Asociado.

#### REVIEW (Reseña/Opinión)
- **Responsabilidad**: Calificaciones cuantitativas y comentarios de clientes sobre productos específicos.
- **Relaciones**: N:1 con Producto, N:1 con Cliente.
- **Dependencias**: Producto y Cliente.

#### MEDIA (Multimedia)
- **Responsabilidad**: URLs de imágenes y videos del CMS, reseñas y catálogo.
- **Relaciones**: N:1 con entidades propietarias (Productos, Reviews, CMS).
- **Dependencias**: Entidad asociada.

#### BLOG, CMS_PAGE & LANDING (Contenido)
- **Responsabilidad**: Almacenar la estructura del CMS, posts, páginas dinámicas y constructor visual de plantillas.
- **Relaciones**: CMS_Page 1:N Sections, Section 1:N Widgets.
- **Dependencias**: Ninguna.

#### CHAT & MESSAGE (Mensajería)
- **Responsabilidad**: Soporte al cliente integrado por chat en vivo.
- **Relaciones**: Chat 1:N Messages.
- **Dependencias**: Cliente.

#### COUPON, PROMOTION & DISCOUNT (Reglas de Precio)
- **Responsabilidad**: Reglas dinámicas de descuentos automáticos o cupones de cupón.
- **Relaciones**: N:M con productos elegibles.
- **Dependencias**: Ninguna.

#### GIFT_CARD (Tarjeta de Regalo)
- **Responsabilidad**: Saldos prepagados canjeables.
- **Relaciones**: N:1 con Cliente comprador, 1:N con transacciones de consumo.
- **Dependencias**: Comprador inicial.

#### NOTIFICATION (Notificaciones)
- **Responsabilidad**: Alertas del sistema para el cliente (push, email, SMS).
- **Relaciones**: N:1 con Cliente.
- **Dependencias**: Cliente.

#### AUDIT (Registro de Auditoría)
- **Responsabilidad**: Historial inmutable de cambios críticos del sistema (SOC 2).
- **Relaciones**: N:1 con usuario causante.
- **Dependencias**: Ninguna.

---

## CAPÍTULO 4: Access Patterns (Patrones de Acceso)

Definimos todos los patrones de acceso de CommerceOS antes de estructurar físicamente la base de datos. Esta es la garantía de que ninguna consulta requerirá escaneos.

### Catálogo de Patrones de Acceso (AP)

#### Dominios de Clientes y Direcciones (Customer)
- **AP-001**: Obtener perfil de cliente por su ID único (`customerId`).
- **AP-002**: Obtener perfil de cliente por su correo electrónico (`email`).
- **AP-003**: Listar todas las direcciones guardadas de un cliente específico.
- **AP-004**: Obtener una dirección específica por su ID.

#### Dominios de Catálogo (Category, Product, Variant, Brand, Collection)
- **AP-005**: Obtener producto por su ID único (`productId`).
- **AP-006**: Obtener producto por su campo URL único (`slug`).
- **AP-007**: Listar productos pertenecientes a una Categoría específica (ordenados por fecha).
- **AP-008**: Listar productos de una Colección específica.
- **AP-009**: Listar productos de una Marca específica.
- **AP-010**: Listar variantes asociadas a un producto.
- **AP-011**: Obtener variante específica por su código de barras (`SKU` / `EAN`).
- **AP-012**: Listar categorías hijas de una categoría raíz dada (navegación jerárquica).

#### Dominios de Ventas y Transacciones (Order, Payment, Shipment)
- **AP-013**: Obtener cabecera de pedido por su ID (`orderId`).
- **AP-014**: Listar todos los ítems comprados dentro de un pedido (`ORDER_ITEM`).
- **AP-015**: Listar historial de pedidos de un Cliente específico (ordenado del más reciente al más antiguo).
- **AP-016**: Listar pedidos por Estado (ej: buscar todos los pedidos con estado `PENDING_SHIPMENT`).
- **AP-017**: Obtener transacciones de pago asociadas a un pedido.
- **AP-018**: Obtener estado del envío y traza logística por ID de pedido.

#### Dominios de Contenido y CMS (CMS_Page, Section, Widget, Blog)
- **AP-019**: Obtener estructura completa de una página de CMS por su ruta de acceso/slug.
- **AP-020**: Listar entradas de Blog publicadas, ordenadas de forma cronológica descendente.
- **AP-021**: Obtener una sección específica del constructor con sus widgets asociados.

#### Dominios de Marketing y Fidelización (Coupon, Promotion, Gift_Card)
- **AP-022**: Obtener saldo e historial de consumos de una Gift Card por su código secreto de verificación.
- **AP-023**: Validar cupón de descuento por su nombre identificador (ej: `SUMMER2026`).

#### Dominios de Soporte y Mensajería (Chat, Message)
- **AP-024**: Listar chats activos de soporte técnico asignados a un Agente.
- **AP-025**: Listar mensajes dentro de una sala de chat específica ordenados cronológicamente.

---

## CAPÍTULO 5: Diseño Completo de la Single Table

La tabla unificada de persistencia para el sistema se denominará `CommerceOS`.

### Atributos Físicos del Esquema Base
- **PK** (Partition Key): String (HASH)
- **SK** (Sort Key): String (RANGE)
- **entity**: String (Identificador de tipo de entidad, útil para deserialización)
- **schemaVersion**: Number (Entero de control de versión del payload)
- **version**: Number (Contador para Optimistic Locking)
- **createdAt**: String (ISO 8601 UTC)
- **updatedAt**: String (ISO 8601 UTC)
- **deletedAt**: String (ISO 8601 UTC, opcional)
- **isDeleted**: Boolean (Indicador de borrado lógico)
- **expiresAt**: Number (Unix Epoch segundos, para TTL automático)

---

### Mapeo Físico de Entidades (Estrategia PK/SK)

| Entidad | Prefijo/Patrón PK | Prefijo/Patrón SK | Atributo Principal Indexado (GSI1PK) |
| :--- | :--- | :--- | :--- |
| **Customer** | `CUSTOMER#<customerId>` | `METADATA` | `EMAIL#<email>` |
| **Address** | `CUSTOMER#<customerId>` | `ADDRESS#<addressId>` | N/A |
| **Product** | `PRODUCT#<productId>` | `METADATA` | `SLUG#<slug>` o `CATEGORY#<catId>` |
| **Variant** | `PRODUCT#<productId>` | `VARIANT#<variantId>` | `SKU#<sku>` |
| **Category** | `CATEGORY#<catId>` | `METADATA` | `PARENT#<parentId>` |
| **Order** | `ORDER#<orderId>` | `METADATA` | `CUSTOMER#<customerId>` |
| **OrderItem**| `ORDER#<orderId>` | `ITEM#<variantId>` | N/A |
| **Payment** | `ORDER#<orderId>` | `PAYMENT#<paymentId>` | N/A |
| **Shipment** | `ORDER#<orderId>` | `SHIPMENT#<shipmentId>`| N/A |
| **Review** | `PRODUCT#<productId>` | `REVIEW#<reviewId>` | `CUSTOMER#<customerId>` |
| **GiftCard** | `GIFTCARD#<cardId>` | `METADATA` | `CODE#<secretCode>` |
| **CMSPage** | `CMS#<pageId>` | `METADATA` | `SLUG#<slug>` |
| **Chat** | `CHAT#<chatId>` | `METADATA` | `AGENT#<agentId>` |
| **Message** | `CHAT#<chatId>` | `MESSAGE#<ksuid>` | N/A |

---

## CAPÍTULO 6: Diseño Completo de GSIs (Global Secondary Indexes)

Para resolver los patrones de acceso de búsqueda cruzada y listado ordenado sin requerir escaneos, definiremos un máximo de 3 Índices Secundarios Globales (GSIs).

### 1. GSI1 (Índice de Inversión y Búsqueda Única)
- **GSI1PK**: String (HASH)
- **GSI1SK**: String (RANGE)
- **Proyección**: `ALL` *(Requerido porque las consultas alternativas sobre slugs, emails y SKUs necesitan recuperar el ítem completo para retornarlo a las capas de negocio).*
- **Propósito**: Resolver buscas de unicidad alternativas al ID primario.
  - Ejemplo: Buscar cliente por email (`GSI1PK: EMAIL#john@doe.com`, `GSI1SK: METADATA`).
  - Ejemplo: Buscar variante por SKU (`GSI1PK: SKU#ZAP-R-42`, `GSI1SK: METADATA`).
  - Ejemplo: Buscar producto por slug (`GSI1PK: SLUG#zapatos-premium`, `GSI1SK: METADATA`).

### 2. GSI2 (Índice Cronológico y de Estado)
- **GSI2PK**: String (HASH)
- **GSI2SK**: String (RANGE)
- **Proyección**: `INCLUDE` *(Proyecta selectivamente campos esenciales como totales, estados, nombres y referencias para minimizar costos de almacenamiento).*
- **Atributos Proyectados**: `id`, `entity`, `status`, `createdAt`, `totalAmount`, `isDeleted`.
- **Propósito**: Listar registros ordenados cronológicamente por su fecha de creación o agrupados por estado actual.
  - Ejemplo: Obtener el historial de pedidos de un cliente ordenado del más nuevo al más viejo (`GSI2PK: CUSTOMER#usr_123`, `GSI2SK: ORDER#2026-07-15T12:00:00.000Z`).
  - Ejemplo: Listar productos pertenecientes a una categoría ordenados por fecha (`GSI2PK: CATEGORY#cat_abc`, `GSI2SK: PRODUCT#2026-07-15T12:00:00.000Z`).

### 3. GSI3 (Índice de Relación Inversa y Grafos)
- **GSI3PK**: String (HASH)
- **GSI3SK**: String (RANGE)
- **Proyección**: `KEYS_ONLY` *(Optimizado para costes; solo indexa las llaves primarias físicas para comprobación de existencia y relaciones).*
- **Propósito**: Resolver relaciones cruzadas complejas (N:M) y grafos de pertenencia.
  - Ejemplo: Buscar todas las reseñas escritas por un cliente específico (`GSI3PK: CUSTOMER#usr_123`, `GSI3SK: REVIEW#...`).
  - Ejemplo: Mapear pertenencia de colecciones.

---

## CAPÍTULO 7: Modelado de Relaciones

El modelado en DynamoDB requiere técnicas específicas para emular la integridad relacional de bases de datos SQL sin perder rendimiento.

### Relaciones 1:1
- **Implementación**: Co-locación de datos o llaves cruzadas en el mismo Partition Key.
- **Ejemplo (Cliente y Carrito)**: Los metadatos del cliente están en `PK: CUSTOMER#usr_123`, `SK: METADATA`. Su carrito persistente activo se guarda en `PK: CUSTOMER#usr_123`, `SK: CART`. Esto permite obtener el cliente y su carrito en un solo comando de lectura en lote (`BatchGetItem` o `Query`).

### Relaciones 1:N (Item Collection)
- **Implementación**: Usar el Partition Key (`PK`) del padre y diferenciar a los hijos en el Sort Key (`SK`).
- **Ejemplo (Pedido y sus Ítems)**:
  - Cabecera: `PK: ORDER#ord_777`, `SK: METADATA`
  - Item 1: `PK: ORDER#ord_777`, `SK: ITEM#prd_999`
  - Item 2: `PK: ORDER#ord_777`, `SK: ITEM#prd_888`
- **Consulta**: Ejecutando `Query(PK="ORDER#ord_777")` recuperamos el pedido completo y todos sus ítems asociados de una sola vez.

### Relaciones N:M (Adjacency List)
- **Implementación**: Crear ítems de cruce o enlace (en inglés, *junction items*) en la tabla unificada.
- **Ejemplo (Productos y Categorías)**:
  Para mapear que el producto `prd_shoes` pertenece a la categoría `cat_sports` y a la categoría `cat_footwear`:
  - Enlace 1: `PK: PRODUCT#prd_shoes`, `SK: CATEGORY#cat_sports`
  - Enlace 2: `PK: PRODUCT#prd_shoes`, `SK: CATEGORY#cat_footwear`
  - Enlace Inverso 1 (en GSI3): `GSI3PK: CATEGORY#cat_sports`, `GSI3SK: PRODUCT#prd_shoes`
  - Enlace Inverso 2 (en GSI3): `GSI3PK: CATEGORY#cat_footwear`, `GSI3SK: PRODUCT#prd_shoes`

### Jerarquías Infinitas (Categorías Anidadas)
Para dar soporte a árboles de categorías con niveles infinitos de profundidad (ej: *Ropa -> Calzado -> Deportes -> Running*), utilizaremos el patrón **Materialized Path (Ruta Materializada)**.
- En el campo `path` de la categoría guardamos la ruta completa del linaje separada por diagonales: `/ropa/calzado/deportes/running`.
- Al crear o modificar un producto o categoría, indexamos el árbol. Si queremos buscar todos los productos de la categoría raíz `/ropa` y todas sus hijas, podemos realizar una consulta indexada buscando en `GSI2` con el operador `begins_with(GSI2SK, "/ropa")`.

---

## CAPÍTULO 8: Ejemplos Reales de Items (Formato JSON)

Representaciones reales de cómo lucirán las estructuras JSON almacenadas en la base de datos de DynamoDB para CommerceOS.

### Item: Categoría
```json
{
  "PK": "CATEGORY#cat_01f8me553m0000000000000010",
  "SK": "METADATA",
  "id": "cat_01f8me553m0000000000000010",
  "entity": "Category",
  "name": "Calzado Deportivo",
  "slug": "calzado-deportivo",
  "path": "/ropa/calzado-deportivo",
  "parentId": "cat_01f8me553m0000000000000001",
  "status": "PUBLISHED",
  "isDeleted": false,
  "version": 1,
  "schemaVersion": 1,
  "createdAt": "2026-07-15T17:40:15.123Z",
  "updatedAt": "2026-07-15T17:40:15.123Z",
  "createdBy": "usr_system",
  "updatedBy": "usr_system",
  "deletedAt": null,
  "deletedBy": null,
  "GSI1PK": "SLUG#calzado-deportivo",
  "GSI1SK": "METADATA"
}
```

### Item: Producto
```json
{
  "PK": "PRODUCT#prd_01f8me553m0000000000000020",
  "SK": "METADATA",
  "id": "prd_01f8me553m0000000000000020",
  "entity": "Product",
  "name": "Zapatillas Trail Running Nitro",
  "slug": "zapatillas-trail-running-nitro",
  "description": "Zapatillas de alta tracción para terrenos montañosos.",
  "brandId": "brd_01f8me553m0000000000000099",
  "status": "PUBLISHED",
  "isDeleted": false,
  "version": 1,
  "schemaVersion": 1,
  "createdAt": "2026-07-15T17:42:10.000Z",
  "updatedAt": "2026-07-15T17:42:10.000Z",
  "createdBy": "usr_admin_1",
  "updatedBy": "usr_admin_1",
  "deletedAt": null,
  "deletedBy": null,
  "GSI1PK": "SLUG#zapatillas-trail-running-nitro",
  "GSI1SK": "METADATA",
  "GSI2PK": "CATEGORY#cat_01f8me553m0000000000000010",
  "GSI2SK": "PRODUCT#2026-07-15T17:42:10.000Z"
}
```

### Item: Pedido (Orden)
```json
{
  "PK": "ORDER#ord_01f8me553m0000000000000050",
  "SK": "METADATA",
  "id": "ord_01f8me553m0000000000000050",
  "entity": "Order",
  "customerId": "usr_01f8me553m0000000000000100",
  "status": "PENDING",
  "totalAmount": 129.99,
  "currency": "USD",
  "isDeleted": false,
  "version": 1,
  "schemaVersion": 1,
  "createdAt": "2026-07-15T17:45:00.000Z",
  "updatedAt": "2026-07-15T17:45:00.000Z",
  "createdBy": "usr_01f8me553m0000000000000100",
  "updatedBy": "usr_01f8me553m0000000000000100",
  "deletedAt": null,
  "deletedBy": null,
  "GSI2PK": "CUSTOMER#usr_01f8me553m0000000000000100",
  "GSI2SK": "ORDER#2026-07-15T17:45:00.000Z"
}
```

---

## CAPÍTULO 9: Consultas (Queries)

Explicamos detalladamente cómo resolver los patrones de acceso clave sin recurrir jamás a operaciones de `Scan`.

### Búsqueda de Producto por Slug (AP-006)
- **Estrategia**: Consulta directa sobre el índice secundario global `GSI1`.
- **Parámetros**:
  - `IndexName`: `"GSI1"`
  - `KeyConditionExpression`: `"GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk"`
  - `ExpressionAttributeValues`:
    - `:gsi1pk`: `"SLUG#zapatillas-trail-running-nitro"`
    - `:gsi1sk`: `"METADATA"`
- **Rendimiento**: O(1) tiempo de búsqueda. DynamoDB accede directamente al registro proyectado en el índice.

### Listar Historial de Pedidos de un Cliente por Fecha (AP-015)
- **Estrategia**: Consulta en el índice secundario global `GSI2` con ordenamiento inverso.
- **Parámetros**:
  - `IndexName`: `"GSI2"`
  - `KeyConditionExpression`: `"GSI2PK = :gsi2pk AND GSI2SK BEGINS_WITH(:gsi2skPrefix)"`
  - `ScanIndexForward`: `false` *(Forza a DynamoDB a ordenar los ítems en base a la Sort Key de forma descendente, entregando primero los pedidos más recientes).*
  - `ExpressionAttributeValues`:
    - `:gsi2pk`: `"CUSTOMER#usr_01f8me553m0000000000000100"`
    - `:gsi2skPrefix`: `"ORDER#"`

---

## CAPÍTULO 10: Paginación

La paginación en bases de datos NoSQL difiere de la paginación basada en compensación o salto (Offset/Limit) común en bases de datos SQL relacionales. SQL lee y descarta registros intermedios para llegar al offset. En DynamoDB, esto dispararía costos insostenibles.

### Estrategia: Paginación Basada en Cursores (Keyset Pagination)
DynamoDB retorna de forma nativa un atributo opcional en las operaciones de Query llamado `LastEvaluatedKey` si la cantidad de datos leídos excede el límite configurado (`Limit`) o el límite físico de 1MB por lectura.

1. **El Cursor**: El `LastEvaluatedKey` (que contiene las llaves primarias físicas `PK`, `SK` y las del índice si aplica) es serializado a una cadena cifrada en **Base64** para ocultar la estructura interna de la base de datos a los clientes web y móviles.
2. **Consumo del Cursor**: Para solicitar la siguiente página, el cliente envía esta cadena Base64 (ej: `cursor=eyJQSyI6Ik9SREVSIyIsIlNLI...`).
3. **Procesamiento en Backend**: El repositorio deserializa la cadena Base64 a su formato original JSON de DynamoDB y la inyecta en el parámetro `ExclusiveStartKey` de la siguiente llamada `Query`.
4. **Final del Listado**: Si la llamada Query retorna un ítem sin `LastEvaluatedKey`, se infiere que hemos llegado al final de la colección y se envía un cursor `null` al cliente.

---

## CAPÍTULO 11: Repository Pattern (Patrón Repositorio)

El flujo de control de acceso a datos debe seguir una dirección estrictamente unidireccional para garantizar el desacoplamiento de capas (Clean Architecture).

```
[Handler Lambda]
       │
       ▼ (Parsea evento, inyecta TraceId)
[Validador] (Valida DTO de entrada con Zod/Joi)
       │
       ▼
[Servicio de Caso de Uso] (Ejecuta lógica de negocio e invariantes de dominio)
       │
       ▼
[Repositorio de Dominio] (Mapea entidades limpias de negocio a esquemas de base de datos)
       │
       ▼
[Cliente DynamoDB] (Conexión física y operaciones SDK de AWS)
```

### Reglas del Repositorio
- El Handler de Lambda nunca realiza llamadas directas al SDK de AWS DynamoDB.
- Los repositorios son las únicas clases autorizadas a instanciar clientes de base de datos o definir objetos de DynamoDB (`ExpressionAttributeValues`, `UpdateExpression`).
- El repositorio retorna exclusivamente instancias limpias del modelo de dominio o tipos primitivos estándar de JS.

---

## CAPÍTULO 12: Eventos e Idempotencia

El registro en DynamoDB actúa como el origen único de la verdad. Los eventos de dominio se publican como consecuencia inmediata de mutaciones de datos exitosas.

### Transaccionalidad de Eventos (Outbox Pattern)
Para garantizar la entrega de eventos sin fallos, el repositorio ejecuta una operación transaccional (`TransactWriteItems`) al guardar datos:
1. Inserta o modifica el ítem de negocio (ej: `ORDER#123`).
2. Inserta un ítem de evento en una sub-colección outbox dentro de la misma tabla de DynamoDB: `PK: EVENT#<eventId>`, `SK: METADATA`, con un atributo de TTL corto (ej: 24 horas).
3. Un proceso en segundo plano (vía DynamoDB Streams) lee el evento insertado en la outbox y lo publica de forma fiable en el Event Bus de EventBridge.

### Patrón de Idempotencia
Dado que las peticiones HTTP de red pueden duplicarse o reintentarse tras fallos temporales (política *at-least-once* de AWS SQS/EventBridge), la plataforma debe protegerse contra ejecuciones duplicadas de la misma lógica de negocio:

1. Cada petición mutativa debe contener una llave de idempotencia única generada por el cliente (`idempotencyKey`).
2. Al recibir la llamada, la Lambda intenta insertar un registro de bloqueo en DynamoDB: `PK: IDEMPOTENCY#<idempotencyKey>`, `SK: METADATA` con una condición de que la llave no exista (`attribute_not_exists(PK)`) y un TTL corto (ej: 1 hora).
3. Si la inserción tiene éxito, procesamos la petición. Si falla con un error de clave duplicada, rechazamos la petición devolviendo la respuesta cacheada o indicando error de duplicidad.

---

## CAPÍTULO 13: Escalabilidad (Hot Partitions & Write Sharding)

DynamoDB escala distribuyendo sus datos en particiones físicas independientes en base al Partition Key (`PK`). Si una sola Partition Key recibe millones de solicitudes de escritura o lectura concurrentes por segundo, se produce un estrangulamiento de rendimiento debido a una **Hot Partition** (Partición Caliente).

### Prevención de Hot Partitions en CommerceOS
1. **Evitar PKs estáticos de baja cardinalidad**: No crear llaves del tipo `PK: STATUS#ACTIVE` para listar usuarios activos. Esto enviaría a todos los usuarios de la base de datos a la misma partición física.
2. **Write Sharding (Fragmentación de Escrituras)**: Para colecciones de datos masivas que se escriben a tasas extremadamente elevadas (ej: registros analíticos o eventos globales de auditoría), aplicamos un sufijo aleatorio matemático al Partition Key.
   - Si creamos registros de auditoría (`audit_log`), en lugar de guardarlos todos en `PK: AUDIT`, los distribuimos de forma aleatoria usando un factor de división (ej: 0 a 9):
     `PK: AUDIT_SHARD#0`, `PK: AUDIT_SHARD#1` ... `PK: AUDIT_SHARD#9`.
   - Para recuperar todos los registros de auditoría en orden, la capa del repositorio realiza consultas paralelas (Scatter-Gather) a las 10 particiones en paralelo y realiza la ordenación y mezcla (merge) en memoria antes de retornar los datos al llamador.

---

## CAPÍTULO 14: Evolución del Esquema sin Downtime

En arquitecturas enterprise, no podemos apagar la base de datos para ejecutar migraciones destructivas de tablas (como `ALTER TABLE` de SQL). La base de datos debe evolucionar en caliente.

### Estrategia: Lazy Migration (Migración Floja/Perezosa)
1. **Versionado de Registros en Base de Datos**: Todo ítem guardado incluye el atributo numérico `schemaVersion`.
2. **Control de Lectura**: Cuando el Repositorio lee un ítem con una versión antigua (ej: `schemaVersion: 1`), aplica automáticamente una función de transformación (Upcaster) en memoria para transformar el JSON al esquema actual (ej: `schemaVersion: 2`) añadiendo campos por defecto o reestructurando variables.
3. **Escritura en Caliente**: En la próxima actualización del ítem, el repositorio lo guardará con la versión de esquema actualizada (`schemaVersion: 2`). Con el tiempo, los registros más activos se migran solos de forma transparente y sin impacto en base de datos.
4. **Migración en Lote para Datos Fríos**: Para registros históricos inactivos que deban actualizarse de forma obligatoria, se ejecuta una tarea asíncrona de fondo en AWS ECS o Lambda que realiza un escaneo de baja velocidad (controlando las RCUs consumidas) leyendo ítems antiguos y escribiéndolos de nuevo actualizados.

---

## CAPÍTULO 15: Checklist de Persistencia para Nuevas Entidades

Cualquier nuevo módulo de negocio o programador que decida añadir una nueva entidad a la Single Table de CommerceOS debe validar el cumplimiento estricto del siguiente checklist:

- [ ] **Definición de Access Patterns**: Se han documentado todos los patrones de acceso de lectura y escritura antes de escribir código.
- [ ] **Definición de PK y SK**: Se han especificado los prefijos e identificadores para `PK` y `SK` de la entidad evitando cualquier posibilidad de colisión con dominios existentes.
- [ ] **Mapeo de Índices (GSIs)**: Se ha verificado que las consultas alternativas se resuelven exclusivamente mediante búsquedas indexadas en los GSIs genéricos existentes (`GSI1`, `GSI2`, `GSI3`).
- [ ] **Control de Concurrencia**: La entidad incluye el atributo `version` de tipo entero y el repositorio implementa escrituras condicionales para bloqueo optimista.
- [ ] **Campos de Auditoría**: El payload de DynamoDB almacena obligatoriamente `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `entity` y `schemaVersion`.
- [ ] **Estrategia de Borrado Lógico**: El repositorio implementa Soft Delete cambiando el estado a `DELETED` y remueve los atributos `GSI1PK`/`GSI1SK` del ítem borrado para limpiar los índices alternativos.
- [ ] **Control de Límite de Tamaño**: Se ha verificado que ningún atributo dinámico del ítem (como descripciones de texto libre) pueda superar los 400KB. De lo contrario, se implementa almacenamiento complementario en S3.
- [ ] **Control de Hot Partitions**: Se ha analizado la tasa de transacciones de escritura esperada. Si excede 1,000 escrituras por segundo para una sola Partition Key, se ha diseñado un patrón de Write Sharding.
