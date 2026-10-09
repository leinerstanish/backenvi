# ENTITY CATALOG - proStore CommerceOS
**Especificación Técnica de Esquema y Patrones de Acceso de Datos**  
**Versión:** 1.0.0  
**Fecha:** 2026-07-15  
**Estado:** Borrador de Trabajo / Persistencia de Datos  

---

## INTRODUCCIÓN Y REGLA DE INDEXACIÓN GENÉRICA
Como se definió en las convenciones globales, para optimizar el uso de los Índices Secundarios Globales (GSIs) en un diseño de **Tabla Única (Single Table Design)**, nunca indexamos atributos aislados en crudo. En su lugar, utilizamos un esquema de **Llaves Genéricas Polimórficas**.
Cualquier campo indexable/buscable se mapeará al índice genérico `GSI1` utilizando el prefijo correspondiente al patrón de consulta (ej: `GSI1PK: SLUG#<slug_value>`). Esto nos permite reutilizar un solo índice físico para resolver múltiples consultas de negocio distintas.

---

## 1. CATEGORY (Categoría)

### Responsabilidad
Navegación taxonómica y estructuración del catálogo de productos. Soporta anidación jerárquica infinita mediante rutas materializadas (Materialized Paths).

### Atributos / Campos
| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | String | Sí | ID único de categoría (`cat_...`). |
| `entity` | String | Sí | `"Category"` |
| `name` | String | Sí | Nombre comercial legible (ej: `"Calzado deportivo"`). |
| `slug` | String | Sí | Slug URL único. |
| `path` | String | Sí | Ruta materializada (ej: `/moda/calzado/deportivo`). |
| `parentId` | String | No | ID de la categoría padre (nulo si es raíz). |
| `status` | String | Sí | `DRAFT \| PUBLISHED \| ARCHIVED` |
| `isDeleted` | Boolean | Sí | Indicador de borrado lógico. |
| `createdAt` | String | Sí | Fecha de creación (ISO 8601 UTC). |
| `updatedAt` | String | Sí | Fecha de última actualización (ISO 8601 UTC). |
| `createdBy` | String | Sí | Usuario o sistema creador. |
| `updatedBy` | String | Sí | Último modificador. |
| `version` | Number | Sí | Versión secuencial de bloqueo optimista. |
| `schemaVersion`| Number | Sí | Versión del esquema del payload. |

### Relaciones
- **Categorías Hijas**: 1:N con `Category` (relación autoreferenciada mediante `parentId`).
- **Productos**: N:M con `Product` (resuelto mediante ítems de enlace producto-categoría).

### Mapeo de Persistencia (DynamoDB)
- **PK**: `CATEGORY#<id>`
- **SK**: `METADATA`
- **GSI1PK**: `SLUG#<slug>`
- **GSI1SK**: `METADATA`
- **GSI2PK**: `PARENT#<parentId>` (para listar hijas directas)
- **GSI2SK**: `NAME#<name>`

### Eventos Asociados
- `CATEGORY.CREATED`
- `CATEGORY.UPDATED`
- `CATEGORY.DELETED`

### Access Patterns (Patrones de Acceso)
- **AP-CAT-01**: Obtener categoría por ID (`PK: CATEGORY#<id>`).
- **AP-CAT-02**: Obtener categoría por Slug (`GSI1PK: SLUG#<slug>`).
- **AP-CAT-03**: Listar categorías hijas directas de un `parentId` específico (`GSI2PK: PARENT#<parentId>`).
- **AP-CAT-04**: Listar todas las categorías raíz (`GSI2PK: PARENT#NULL`).

---

## 2. PRODUCT (Producto)

### Responsabilidad
Representar la entidad comercial base de venta. Define los metadatos globales, descripciones, marca y pertenencia taxonómica del catálogo.

### Atributos / Campos
| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | String | Sí | ID único del producto (`prd_...`). |
| `entity` | String | Sí | `"Product"` |
| `name` | String | Sí | Nombre comercial del producto. |
| `slug` | String | Sí | Slug URL único. |
| `description` | String | Sí | Descripción larga del producto. |
| `brandId` | String | Sí | ID de la marca asociada. |
| `seasonId` | String | No | ID de la temporada comercial. |
| `basePrice` | Number | Sí | Precio de lista base del producto. |
| `images` | List | No | Lista de URLs de imágenes alojadas en S3. |
| `status` | String | Sí | `DRAFT \| PUBLISHED \| ARCHIVED \| DELETED` |
| `isDeleted` | Boolean | Sí | Borrado lógico. |
| `createdAt` | String | Sí | Fecha de creación. |
| `updatedAt` | String | Sí | Fecha de modificación. |
| `createdBy` | String | Sí | Creador. |
| `updatedBy` | String | Sí | Modificador. |
| `version` | Number | Sí | Bloqueo optimista. |
| `schemaVersion`| Number | Sí | Versión del payload. |

### Relaciones
- **Variantes**: 1:N con `ProductVariant`.
- **Marca**: N:1 con `Brand`.
- **Colecciones**: N:M con `Collection`.
- **Categorías**: N:M con `Category`.

### Mapeo de Persistencia (DynamoDB)
- **PK**: `PRODUCT#<id>`
- **SK**: `METADATA`
- **GSI1PK**: `SLUG#<slug>`
- **GSI1SK**: `METADATA`
- **GSI2PK**: `CATEGORY#<categoryId>` (para listar productos por categoría)
- **GSI2SK**: `PRODUCT#<status>#<createdAt>` (para filtrar por estado y ordenar cronológicamente)
- **GSI3PK**: `BRAND#<brandId>`
- **GSI3SK**: `PRODUCT#<status>#<createdAt>`

### Eventos Asociados
- `PRODUCT.CREATED`
- `PRODUCT.UPDATED`
- `PRODUCT.DELETED`
- `PRODUCT.STOCK_STATUS_CHANGED`

### Access Patterns (Patrones de Acceso)
- **AP-PROD-01**: Obtener producto por ID (`PK: PRODUCT#<id>`, `SK: METADATA`).
- **AP-PROD-02**: Obtener producto por Slug (`GSI1PK: SLUG#<slug>`, `GSI1SK: METADATA`).
- **AP-PROD-03**: Listar productos activos (`status=PUBLISHED`) de una categoría ordenados por fecha (`GSI2PK: CATEGORY#<catId>`, `GSI2SK` usando `begins_with("PRODUCT#PUBLISHED")`).
- **AP-PROD-04**: Listar productos asociados a una marca específica (`GSI3PK: BRAND#<brandId>`).

---

## 3. PRODUCT_VARIANT (Variante de Producto)

### Responsabilidad
Representar la unidad específica de venta comercializable (Stock Keeping Unit - SKU). Modela las combinaciones físicas de opciones como talla, color y almacenamiento.

### Atributos / Campos
| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | String | Sí | ID único de variante (`var_...`). |
| `productId` | String | Sí | ID del producto padre. |
| `entity` | String | Sí | `"ProductVariant"` |
| `sku` | String | Sí | Código SKU único del inventario (ej: `"NIKE-PEG-BL-42"`). |
| `ean` | String | No | Código de barras estándar (código EAN/UPC). |
| `price` | Number | Sí | Precio de venta final para esta variante. |
| `compareAtPrice`| Number | No | Precio original antes de oferta (tachar precio). |
| `attributes` | Map | Sí | Mapa de atributos clave-valor (ej: `{ "talla": "42", "color": "azul" }`). |
| `images` | List | No | Lista de URLs de imágenes alojadas en S3 específicas a la variante. |
| `status` | String | Sí | `ACTIVE \| INACTIVE \| DELETED` |
| `isDeleted` | Boolean | Sí | Borrado lógico. |
| `createdAt` | String | Sí | Auditoría. |
| `updatedAt` | String | Sí | Auditoría. |
| `version` | Number | Sí | Bloqueo optimista. |

### Relaciones
- **Producto Padre**: N:1 con `Product`.
- **Inventario**: 1:N con `Inventory` (ubicaciones físicas/bodegas).
- **Movimientos de Stock**: 1:N con `StockMovement`.

### Mapeo de Persistencia (DynamoDB)
- **PK**: `PRODUCT#<productId>`
- **SK**: `VARIANT#<id>`
- **GSI1PK**: `SKU#<sku>`
- **GSI1SK**: `METADATA`
- **GSI2PK**: `EAN#<ean>`
- **GSI2SK**: `METADATA`

### Eventos Asociados
- `VARIANT.CREATED`
- `VARIANT.UPDATED`
- `VARIANT.PRICE_CHANGED`

### Access Patterns (Patrones de Acceso)
- **AP-VAR-01**: Obtener variante específica por su ID (`PK: PRODUCT#<productId>`, `SK: VARIANT#<id>`).
- **AP-VAR-02**: Listar todas las variantes asociadas a un producto (`Query` en `PK: PRODUCT#<productId>` con filter `begins_with(SK, "VARIANT#")`).
- **AP-VAR-03**: Obtener variante por SKU (`GSI1PK: SKU#<sku>`).
- **AP-VAR-04**: Obtener variante por código de barras EAN (`GSI2PK: EAN#<ean>`).

---

## 4. INVENTORY & WAREHOUSE (Inventario y Bodegas)

### Responsabilidad
Gestionar las existencias físicas de variantes de productos localizadas en diferentes ubicaciones geográficas o almacenes (bodegas).

### Atributos / Campos (Inventory)
| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `variantId` | String | Sí | Variante del producto. |
| `warehouseId` | String | Sí | ID del almacén o bodega física (`wh_...`). |
| `entity` | String | Sí | `"Inventory"` |
| `stockAvailable`| Number | Sí | Cantidad física lista para la venta. |
| `stockReserved` | Number | Sí | Cantidad comprometida en pedidos pendientes. |
| `stockIncoming` | Number | Sí | Cantidad en tránsito de proveedores. |
| `safetyStock` | Number | Sí | Stock de seguridad mínimo antes de alertar stock bajo. |
| `updatedAt` | String | Sí | Fecha de la última actualización física. |

### Relaciones
- **Variante**: N:1 con `ProductVariant`.
- **Almacén**: N:1 con `Warehouse`.

### Mapeo de Persistencia (DynamoDB)
- **PK**: `PRODUCT_VARIANT#<variantId>`
- **SK**: `WAREHOUSE#<warehouseId>`
- **GSI2PK**: `WAREHOUSE#<warehouseId>` (para listar stock completo de una bodega)
- **GSI2SK**: `STOCK#<stockAvailable>`

### Eventos Asociados
- `INVENTORY.UPDATED`
- `INVENTORY.LOW_STOCK`
- `INVENTORY.OUT_OF_STOCK`

### Access Patterns (Patrones de Acceso)
- **AP-INV-01**: Obtener niveles de stock de una variante en una bodega específica (`PK: PRODUCT_VARIANT#<variantId>`, `SK: WAREHOUSE#<warehouseId>`).
- **AP-INV-02**: Obtener stock consolidado de una variante en todas las bodegas (`Query` en `PK: PRODUCT_VARIANT#<variantId>` con filter `begins_with(SK, "WAREHOUSE#")`).
- **AP-INV-03**: Listar inventarios críticos de una bodega con stock menor al umbral (`GSI2PK: WAREHOUSE#<warehouseId>`, `GSI2SK` con filtro de rango de stock).

---

## 5. CUSTOMER & ADDRESS (Clientes y Direcciones)

### Responsabilidad
Modela el perfil comercial de los compradores del ecommerce, sus datos de contacto y sus ubicaciones físicas para la logística de envíos.

### Atributos / Campos (Customer)
| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | String | Sí | ID del cliente (`usr_...`). |
| `entity` | String | Sí | `"Customer"` |
| `firstName` | String | Sí | Nombres. |
| `lastName` | String | Sí | Apellidos. |
| `email` | String | Sí | Correo electrónico de contacto. |
| `phone` | String | No | Teléfono de contacto. |
| `status` | String | Sí | `ACTIVE \| INACTIVE \| BLOCKED` |
| `isDeleted` | Boolean | Sí | Borrado lógico. |
| `createdAt` | String | Sí | Auditoría. |
| `updatedAt` | String | Sí | Auditoría. |
| `version` | Number | Sí | Bloqueo optimista. |

### Relaciones
- **Direcciones**: 1:N con `Address`.
- **Pedidos**: 1:N con `Order`.

### Mapeo de Persistencia (DynamoDB)
- **PK**: `CUSTOMER#<id>`
- **SK**: `METADATA`
- **GSI1PK**: `EMAIL#<email>`
- **GSI1SK**: `METADATA`

### Eventos Asociados
- `CUSTOMER.REGISTERED`
- `CUSTOMER.UPDATED`
- `CUSTOMER.BLOCKED`

### Access Patterns (Patrones de Acceso)
- **AP-CUST-01**: Obtener perfil de cliente por ID (`PK: CUSTOMER#<id>`, `SK: METADATA`).
- **AP-CUST-02**: Obtener cliente por correo electrónico (`GSI1PK: EMAIL#<email>`).

---

### Atributos / Campos (Address)
| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | String | Sí | ID único de dirección (`adr_...`). |
| `customerId` | String | Sí | ID del cliente propietario. |
| `entity` | String | Sí | `"Address"` |
| `country` | String | Sí | País. |
| `state` | String | Sí | Estado / Provincia / Departamento. |
| `city` | String | Sí | Ciudad. |
| `streetLine1` | String | Sí | Calle principal, número de casa, apto. |
| `streetLine2` | String | No | Indicaciones de entrega adicionales. |
| `postalCode` | String | Sí | Código postal. |
| `isDefault` | Boolean | Sí | Flag para indicar dirección de envío principal. |

### Mapeo de Persistencia (Address en DynamoDB)
- **PK**: `CUSTOMER#<customerId>`
- **SK**: `ADDRESS#<id>`

### Access Patterns (Dirección)
- **AP-ADDR-01**: Listar todas las direcciones de un cliente (`Query` en `PK: CUSTOMER#<customerId>` con filter `begins_with(SK, "ADDRESS#")`).
- **AP-ADDR-02**: Obtener dirección específica del cliente (`PK: CUSTOMER#<customerId>`, `SK: ADDRESS#<id>`).

---

## 6. ORDER & ORDER_ITEM (Pedidos e Ítems)

### Responsabilidad
Modela la transacción financiera y logística de venta. La orden congela todos los precios, impuestos, datos del cliente y estado de los productos en el momento de la compra.

### Atributos / Campos (Order)
| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | String | Sí | ID de orden (`ord_...`). |
| `entity` | String | Sí | `"Order"` |
| `customerId` | String | Sí | ID del cliente. |
| `status` | String | Sí | `PENDING \| PAID \| PROCESSING \| SHIPPED \| COMPLETED \| CANCELLED` |
| `subtotal` | Number | Sí | Subtotal de los ítems. |
| `tax` | Number | Sí | Impuestos aplicados. |
| `shippingCost` | Number | Sí | Costos de despacho. |
| `discount` | Number | Sí | Descuentos aplicados (promociones/cupones). |
| `total` | Number | Sí | Total general a pagar. |
| `paymentMethod`| String | Sí | Método de pago (ej: `"CREDIT_CARD"`, `"COD"`). |
| `isDeleted` | Boolean | Sí | Borrado lógico. |
| `createdAt` | String | Sí | Fecha de creación del pedido. |
| `updatedAt` | String | Sí | Fecha de actualización. |
| `version` | Number | Sí | Bloqueo optimista. |

### Relaciones
- **Comprador**: N:1 con `Customer`.
- **Detalle de Ítems**: 1:N con `OrderItem`.
- **Transacciones de Pago**: 1:N con `Payment`.
- **Despacho Logístico**: 1:1 con `Shipment`.

### Mapeo de Persistencia (DynamoDB)
- **PK**: `ORDER#<id>`
- **SK**: `METADATA`
- **GSI2PK**: `CUSTOMER#<customerId>` (para historial de pedidos del cliente)
- **GSI2SK**: `ORDER#<createdAt>`
- **GSI3PK**: `STATUS#<status>` (para listados operativos en panel de control)
- **GSI3SK**: `ORDER#<createdAt>`

### Eventos Asociados
- `ORDER.CREATED`
- `ORDER.PAID`
- `ORDER.PROCESSING`
- `ORDER.SHIPPED`
- `ORDER.CANCELLED`

### Access Patterns (Patrones de Acceso)
- **AP-ORD-01**: Obtener pedido por ID (`PK: ORDER#<id>`, `SK: METADATA`).
- **AP-ORD-02**: Listar pedidos de un cliente ordenados por fecha (`GSI2PK: CUSTOMER#<customerId>`, `GSI2SK` con filtro de rango `ORDER#`).
- **AP-ORD-03**: Listar pedidos con un estado específico (ej: `PENDING`) para su procesamiento en almacén (`GSI3PK: STATUS#PENDING`).

---

### Atributos / Campos (OrderItem)
| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `orderId` | String | Sí | ID del pedido padre. |
| `variantId` | String | Sí | ID de la variante comprada. |
| `entity` | String | Sí | `"OrderItem"` |
| `sku` | String | Sí | SKU de la variante comprado. |
| `name` | String | Sí | Nombre del producto congelado. |
| `price` | Number | Sí | Precio unitario congelado. |
| `quantity` | Number | Sí | Cantidad comprada. |

### Mapeo de Persistencia (OrderItem en DynamoDB)
- **PK**: `ORDER#<orderId>`
- **SK**: `ITEM#<variantId>`

### Access Patterns (OrderItem)
- **AP-ORD-ITEM-01**: Listar todos los ítems de un pedido (`Query` en `PK: ORDER#<orderId>` con filter `begins_with(SK, "ITEM#")`).

---

## 7. REVIEW (Reseñas)

### Responsabilidad
Almacena comentarios, calificaciones numéricas (1 a 5 estrellas) e imágenes provistas por los clientes para evaluar su satisfacción con un producto.

### Atributos / Campos
| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | String | Sí | ID único de reseña (`rev_...`). |
| `productId` | String | Sí | ID del producto evaluado. |
| `customerId` | String | Sí | ID del cliente calificador. |
| `entity` | String | Sí | `"Review"` |
| `rating` | Number | Sí | Puntuación del 1 al 5. |
| `comment` | String | No | Comentario en texto libre. |
| `images` | List | No | Lista de URLs de imágenes alojadas en S3. |
| `status` | String | Sí | `PENDING_APPROVAL \| APPROVED \| REJECTED` |
| `createdAt` | String | Sí | Fecha de la reseña. |

### Mapeo de Persistencia (DynamoDB)
- **PK**: `PRODUCT#<productId>`
- **SK**: `REVIEW#<id>`
- **GSI2PK**: `CUSTOMER#<customerId>` (para ver las opiniones de un cliente específico)
- **GSI2SK**: `REVIEW#<createdAt>`

### Access Patterns (Patrones de Acceso)
- **AP-REV-01**: Listar opiniones aprobadas de un producto (`Query` en `PK: PRODUCT#<productId>` con filter `begins_with(SK, "REVIEW#")` filtrando en aplicación por estado `status=APPROVED`).
- **AP-REV-02**: Listar opiniones de un cliente específico (`GSI2PK: CUSTOMER#<customerId>`).

---

## 8. CMS_PAGE (Páginas de Contenido)

### Responsabilidad
Almacena la configuración visual de páginas del storefront (Landings, Home, Políticas de privacidad). Contiene la estructura JSON jerárquica de secciones y widgets (CMS tipo Elementor).

### Atributos / Campos
| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | String | Sí | ID único de página (`cms_...`). |
| `entity` | String | Sí | `"CMSPage"` |
| `title` | String | Sí | Título interno de la página. |
| `slug` | String | Sí | Ruta de la página (ej: `"sobre-nosotros"`). |
| `layout` | Map | Sí | Mapa JSON con las secciones, columnas y widgets del builder. |
| `status` | String | Sí | `DRAFT \| PUBLISHED` |
| `isDeleted` | Boolean | Sí | Borrado lógico. |
| `createdAt` | String | Sí | Auditoría. |
| `updatedAt` | String | Sí | Auditoría. |

### Mapeo de Persistencia (DynamoDB)
- **PK**: `CMS#<id>`
- **SK**: `METADATA`
- **GSI1PK**: `SLUG#<slug>`
- **GSI1SK**: `METADATA`

### Access Patterns (Patrones de Acceso)
- **AP-CMS-01**: Obtener página CMS por ID (`PK: CMS#<id>`, `SK: METADATA`).
- **AP-CMS-02**: Obtener página CMS por ruta de acceso/slug (`GSI1PK: SLUG#<slug>`, `GSI1SK: METADATA`).

---

## 9. CHAT & MESSAGE (Mensajería)

### Responsabilidad
Modela los chats en vivo de soporte técnico al cliente y la base histórica de mensajes enviados y recibidos.

### Atributos / Campos (Chat)
| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | String | Sí | ID único de sala (`cht_...`). |
| `customerId` | String | Sí | ID del cliente del chat. |
| `agentId` | String | No | ID del agente de soporte asignado. |
| `entity` | String | Sí | `"Chat"` |
| `status` | String | Sí | `OPEN \| ASSIGNED \| CLOSED` |
| `createdAt` | String | Sí | Fecha de inicio. |

### Mapeo de Persistencia (DynamoDB)
- **PK**: `CHAT#<id>`
- **SK**: `METADATA`
- **GSI2PK**: `AGENT#<agentId>` (para listar chats asignados a un agente)
- **GSI2SK**: `CHAT#<status>#<createdAt>`
- **GSI3PK**: `CUSTOMER#<customerId>` (para listar chats históricos de un cliente)
- **GSI3SK**: `CHAT#<status>#<createdAt>`

---

### Atributos / Campos (Message)
| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `chatId` | String | Sí | ID de sala propietaria. |
| `id` | String | Sí | ID de mensaje (`msg_...`). |
| `senderId` | String | Sí | ID de la entidad que envía (cliente o agente). |
| `senderType` | String | Sí | `CUSTOMER \| AGENT \| SYSTEM` |
| `entity` | String | Sí | `"Message"` |
| `content` | String | Sí | Contenido del mensaje. |
| `createdAt` | String | Sí | Marca de tiempo precisa del envío. |

### Mapeo de Persistencia (Message en DynamoDB)
- **PK**: `CHAT#<chatId>`
- **SK**: `MESSAGE#<createdAt>`

### Access Patterns (Chat y Mensajes)
- **AP-CHAT-01**: Listar salas de chat activas de un agente (`GSI2PK: AGENT#<agentId>`).
- **AP-CHAT-02**: Listar salas de chat del cliente (`GSI3PK: CUSTOMER#<customerId>`).
- **AP-CHAT-03**: Recuperar todos los mensajes de un chat ordenados cronológicamente (`Query` en `PK: CHAT#<chatId>` con filter `begins_with(SK, "MESSAGE#")`).

---

## 10. COUPON & PROMOTION (Reglas de Descuento)

### Responsabilidad
Modela cupones promocionales manuales y reglas de descuento automáticas aplicables al carrito de compras.

### Atributos / Campos (Coupon)
| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | String | Sí | ID del cupón (`cup_...`). |
| `code` | String | Sí | Código de cupón (ej: `"SUMMER26"`). |
| `entity` | String | Sí | `"Coupon"` |
| `discountType` | String | Sí | `PERCENTAGE \| FIXED_AMOUNT` |
| `discountValue`| Number | Sí | Valor de la rebaja. |
| `usageLimit` | Number | No | Cantidad máxima de canjes totales permitidos. |
| `usageCount` | Number | Sí | Cantidad de canjes ejecutados a la fecha. |
| `status` | String | Sí | `ACTIVE \| INACTIVE` |
| `expiresAt` | Number | No | Marca de tiempo (segundos Unix) para expiración lógica. |

### Mapeo de Persistencia (DynamoDB)
- **PK**: `COUPON#<id>`
- **SK**: `METADATA`
- **GSI1PK**: `CODE#<code>`
- **GSI1SK**: `METADATA`

### Access Patterns (Cupón)
- **AP-CUP-01**: Validar existencia y estado de cupón por código (`GSI1PK: CODE#<code>`).

---

## 11. GIFT_CARD (Tarjetas de Regalo)

### Responsabilidad
Gestiona saldos prepagados comprados por un cliente para ser regalados a otro, con su traza de consumo transaccional.

### Atributos / Campos
| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | String | Sí | ID único de tarjeta (`gft_...`). |
| `code` | String | Sí | Código secreto único de verificación (ej: `"1234-ABCD-5678-EFGH"`). |
| `entity` | String | Sí | `"GiftCard"` |
| `initialBalance`| Number | Sí | Saldo inicial asignado. |
| `currentBalance`| Number | Sí | Saldo remanente. |
| `status` | String | Sí | `ACTIVE \| EXHAUSTED \| INACTIVE` |
| `createdAt` | String | Sí | Creación. |
| `expiresAt` | String | No | Fecha de vencimiento. |

### Mapeo de Persistencia (DynamoDB)
- **PK**: `GIFTCARD#<id>`
- **SK**: `METADATA`
- **GSI1PK**: `CODE#<code>`
- **GSI1SK**: `METADATA`

### Access Patterns (Gift Cards)
- **AP-GFT-01**: Obtener Gift Card por su código de verificación (`GSI1PK: CODE#<code>`).

---

## 12. AUDIT_LOG (Trazabilidad Forense)

### Responsabilidad
Registro histórico inmutable de toda acción ejecutada por usuarios administradores sobre entidades críticas en la plataforma (requisito de cumplimiento SOC 2).

### Atributos / Campos
| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `id` | String | Sí | ID del log (`log_...`). |
| `userId` | String | Sí | ID del usuario ejecutor de la acción. |
| `entity` | String | Sí | `"AuditLog"` |
| `action` | String | Sí | Acción del sistema (ej: `"PRODUCT_PRICE_UPDATED"`). |
| `targetEntity` | String | Sí | Entidad modificada (ej: `"Product"`). |
| `targetId` | String | Sí | ID de la entidad modificada. |
| `oldState` | Map | No | JSON con el estado anterior al cambio. |
| `newState` | Map | No | JSON con el estado nuevo resultante. |
| `ipAddress` | String | Sí | IP de origen del cliente HTTP. |
| `createdAt` | String | Sí | Marca de tiempo precisa UTC de la acción. |

### Mapeo de Persistencia (DynamoDB)
- **PK**: `AUDIT#<id>`
- **SK**: `METADATA`
- **GSI2PK**: `USER#<userId>` (para buscar auditorías de un administrador)
- **GSI2SK**: `AUDIT#<createdAt>`
- **GSI3PK**: `TARGET#<targetEntity>#<targetId>` (auditoría de un ítem específico)
- **GSI3SK**: `AUDIT#<createdAt>`

### Access Patterns (Auditoría)
- **AP-AUD-01**: Listar trazas de auditoría de un administrador ordenadas por fecha (`GSI2PK: USER#<userId>`).
- **AP-AUD-02**: Listar cambios históricos aplicados sobre una entidad específica (`GSI3PK: TARGET#<targetEntity>#<targetId>`).
