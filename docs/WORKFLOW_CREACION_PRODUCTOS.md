# Guía de Integración Frontend: Flujo de Creación de Productos y Variantes

Esta guía detalla el orden exacto y la estructura de datos (JSON) que el frontend debe enviar a las APIs para crear un producto completo con sus variantes, asegurando que toda la información e imágenes queden relacionadas.

## Flujo Lógico de Creación

Para que un producto pueda ser creado exitosamente sin errores de dependencias, el orden de ejecución y creación debe ser el siguiente:

1. **Atributos (Opcional pero recomendado antes)**: Configuración de tallas, colores, etc.
2. **Categorías**: Para organizar el catálogo.
3. **Marcas (Brands)**: El fabricante del producto.
4. **Producto Padre**: La información base (nombre, marca, categoría, imágenes generales).
5. **Variantes (SKUs)**: El inventario real que se vende (talla M, color rojo, imágenes específicas).

---

## 1. Crear Atributos (Endpoint: `POST /attributes`)

Los atributos definen las opciones dinámicas que tendrán las variantes (ej. Talla, Color).

**Payload esperado:**
```json
{
  "name": "Color",
  "values": ["Rojo", "Azul", "Verde"],
  "type": "text", 
  "isRequired": true,
  "isPublished": true
}
```

---

## 2. Crear Categoría (Endpoint: `POST /categories`)

**Payload esperado:**
```json
{
  "name": "Zapatos Deportivos",
  "description": "Calzado para correr y entrenar",
  "parentId": null 
}
```
*(Nota: Si es una subcategoría, envía el ID de la categoría padre en `parentId`. Guarda el `categoryId` de la respuesta).*

---

## 3. Crear Marca (Endpoint: `POST /brands`)

Si la marca tiene un logo, este debe ser subido a S3 primero.

**Payload esperado:**
```json
{
  "name": "Nike",
  "description": "Just do it",
  "logoUrl": "https://tu-bucket-s3.aws.com/logos/nike.png"
}
```
*(Nota: Guarda el `brandId` de la respuesta).*

---

## 4. Crear Producto Padre (Endpoint: `POST /products`)

Con los IDs obtenidos en los selectores del formulario (Categorías y Marcas), y habiendo subido las imágenes generales del producto a S3, creamos el producto padre.

**Payload esperado:**
```json
{
  "name": "Nike Air Zoom Pegasus 40",
  "description": "Zapatillas de running para asfalto.",
  "categoryId": "cat_123456789",
  "brandId": "br_987654321",
  "images": [
    "https://tu-bucket-s3.aws.com/productos/pegasus-principal.jpg",
    "https://tu-bucket-s3.aws.com/productos/pegasus-lateral.jpg"
  ]
}
```
*(Nota Crítica: Guarda el `productId` que devuelve la API. Es **obligatorio** para crear las variantes en el siguiente paso).*

---

## 5. Crear Variantes / SKUs (Endpoint: `POST /variants`)

Por cada combinación generada en el formulario (ej: Talla 42, Color Rojo), debes hacer un `POST` a esta API apuntando al `productId` padre. 

**Payload esperado:**
```json
{
  "productId": "prod_abcdef123456",
  "sku": "NIKE-PEG40-ROJO-42",
  "price": 129.99,
  "stock": 50,
  "attributes": {
    "Color": "Rojo",
    "Talla": "42"
  },
  "images": [
    "https://tu-bucket-s3.aws.com/variantes/pegasus-rojo-1.jpg"
  ]
}
```
*(Nota: Las variantes pueden tener sus propias imágenes en S3, por ejemplo, para mostrar específicamente el zapato rojo al seleccionar el color).*

---

## 6. Ubicaciones y Bodegas (Endpoints: `GET /locations`, `POST /locations`)

Permite gestionar múltiples almacenes o sucursales donde se almacena el stock. Por defecto el sistema crea automáticamente **"Bodega Principal"** si no existe ninguna.

**Crear Ubicación (`POST /locations`):**
```json
{
  "name": "Bodega Norte",
  "code": "BOD-02",
  "location": "Calle 100 #15-20, Bogotá",
  "isDefault": false
}
```

---

## 7. Control de Inventario y Ajustes de Stock (Cargas y Bajas)

El módulo de inventario controla la existencia física de cada producto por ubicación y registra cada movimiento en el Kardex (`inventory_movements_table`).

### 7.1. Consultar Inventario (`GET /inventory` o `GET /inventory?search={termino}`)
Retorna la lista de items en formato compatible con el frontend:
```json
{
  "items": [
    {
      "id": "inv_123abc456def",
      "productId": "prod_abcdef123456",
      "warehouseId": "loc_main_01",
      "quantity": 50,
      "reservedQuantity": 0,
      "availableQuantity": 50,
      "reorderLevel": 10,
      "lastRestockDate": "2026-09-07T19:00:00.000Z",
      "product": {
        "name": "Nike Air Zoom Pegasus 40",
        "sku": "GAP-PL9",
        "price": 150000
      },
      "warehouse": {
        "name": "Bodega Principal",
        "location": "Sede Principal"
      }
    }
  ],
  "total": 1
}
```

### 7.2. Cargas y Bajas de Stock (`POST /inventory/{id}/adjust`)
Ajusta la existencia física y genera el registro en el historial.

- **Carga / Reabastecimiento (Entrada):**
```json
{
  "quantity": 20,
  "reason": "RESTOCK",
  "notes": "Llegada de pedido de proveedor"
}
```

- **Baja por Daño o Pérdida (Salida):**
```json
{
  "quantity": 3,
  "reason": "DAMAGE",
  "notes": "Producto averiado durante transporte"
}
```
*(Nota: Con motivos `DAMAGE` o `LOST`, el backend resta automáticamente la cantidad indicada).*

- **Motivos disponibles (`reason`):**
  - `RESTOCK`: Reabastecimiento / Carga de inventario (+).
  - `DAMAGE`: Producto dañado o roto (-).
  - `LOST`: Producto perdido o extraviado (-).
  - `RETURN`: Devolución de cliente (+).
  - `ADJUSTMENT`: Ajuste manual por conteo físico.

### 7.3. Consultar Stock Bajo (`GET /inventory/status/low-stock`)
Devuelve todos los productos cuya cantidad disponible es menor o igual a su `reorderLevel`.

---

## Checklist Crítico para el equipo de Frontend:
1. **Flujo de Imágenes a S3**: Siempre suban las fotos directamente a S3 desde el cliente web. El backend **solo** espera recibir las URLs (`https://...`) en formato de arreglo `["url1", "url2"]`.
2. **Carga Inicial del Formulario**: El formulario "Crear Producto" debe hacer peticiones `GET` previas a `/categories`, `/brands` y `/attributes` para llenar las listas desplegables (Selects) y permitir al usuario elegir los valores.
3. **Ejecución en Lote (Batching)**: Al presionar "Guardar Producto", el frontend debe:
   - Disparar `POST /products`.
   - Esperar la respuesta para obtener el `productId`.
   - Ejecutar un bucle (loop) disparando `POST /variants` tantas veces como variantes haya configurado el usuario, inyectando el `productId` obtenido.
4. **Control de Stock**: Desde la pestaña **Inventario**, al presionar "Ajustar Stock", el modal dispara `POST /inventory/{id}/adjust`, el cual actualiza el stock en vivo y recalcula la disponibilidad.

