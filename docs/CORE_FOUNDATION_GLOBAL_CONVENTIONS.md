# CORE FOUNDATION - Global Conventions
**Documento Técnico Oficial de la Plataforma Enterprise Serverless de proStore**  
**Versión:** 1.0.0  
**Fecha:** 2026-07-15  
**Estado:** Aprobado/Base de Arquitectura  

---

## 1. Filosofía del Proyecto

El desarrollo del backend de **proStore** se cimenta sobre la filosofía **Cloud-Native Serverless First**, priorizando la escalabilidad automática, la reducción de costes por inactividad y la delegación de la infraestructura operativa en proveedores gestionados (principalmente AWS).

### Objetivos de la Arquitectura
- **Elasticidad Extrema**: Capacidad de escalar de cero a millones de peticiones concurrentes de forma transparente y sin aprovisionar servidores físicos.
- **Aislamiento Fuerte**: Evitar efectos cascada mediante la descentralización de dominios lógicos y de almacenamiento.
- **Bajo Acoplamiento**: Comunicación asíncrona por eventos como canal primario de integración entre sub-sistemas.

### Principios de Diseño
1. **Clean Architecture (Arquitectura Limpia)**:
   Dividimos la aplicación en capas concéntricas con una estricta regla de dependencia: **las capas externas dependen de las internas, pero las internas no conocen nada de las externas**.
   - **Capa Externa (Infraestructura / Handlers)**: Lambdas, controladores de API Gateway, eventos de EventBridge, conexiones físicas a DynamoDB.
   - **Capa Media (Casos de Uso / Servicios)**: Lógica de negocio de la aplicación, transacciones de dominio, coordinadores de flujo.
   - **Capa Interna (Dominio / Entidades)**: Reglas esenciales de negocio, entidades de dominio y validadores primitivos libres de frameworks.
2. **Domain-Driven Design (DDD)**:
   Modelamos la plataforma en base a **Contextos Acotados (Bounded Contexts)** autónomos (ej: *Usuarios*, *Productos*, *Pedidos*, *Inventario*, *Pagos*). Cada contexto maneja su propio modelo mental, sus propios agregados y su propio almacenamiento físico en la base de datos single-table.
3. **Event-Driven Architecture (EDA)**:
   Cualquier cambio de estado significativo en un agregador de dominio emite un evento al **Bus Central de EventBridge**. Esto permite que otros microservicios actúen reactivamente sin bloquear la petición original (ej: notificaciones por email, actualización de índices en OpenSearch).
4. **Serverless First & Cloud Native**:
   Preferimos servicios totalmente gestionados sobre infraestructura autogestionada. Si existe un servicio nativo de AWS calificado (ej: Cognito para Auth, EventBridge para mensajería, SQS para colas, S3 para activos), se utilizará por encima de soluciones externas o desarrollos a medida.

---

## 2. Convenciones de IDs

El diseño enterprise requiere un estándar único para identificar registros, evitando colisiones a gran escala, facilitando la ordenación temporal y permitiendo a los desarrolladores identificar visualmente cualquier recurso en trazas de logs o depuración.

### Comparativa Técnica

| Característica | UUID v4 | ULID | KSUID (Elegido) |
| :--- | :--- | :--- | :--- |
| **Tamaño** | 128 bits | 128 bits | 160 bits (mayor aleatoriedad) |
| **Representación** | Hex con guiones (36 chars) | Base32 (26 chars) | Base62 (27 chars, URL Safe) |
| **Ordenable** | No (Aleatorio completo) | Sí (Timestamp de 48 bits al inicio) | Sí (Timestamp de 32 bits al inicio) |
| **Resistencia a Colisiones** | Alta | Alta | Extremadamente Alta |
| **Identificable** | No | No | No (a menos que se añada un prefijo) |

### Estándar Oficial: Prefixed KSUID
Adoptamos el uso de **KSUID con prefijo de entidad**.
- **Ventaja de KSUID**: Al poseer un timestamp incrustado de alta precisión en la parte inicial, los IDs se ordenan cronológicamente de manera lexicográfica. Esto nos permite ordenar registros en DynamoDB por fecha de creación directamente usando el ID de la entidad, ahorrando índices secundarios globales (GSI).
- **Ventaja del Prefijo**: Permite la identificación instantánea del tipo de recurso en logs globales, trazas de X-Ray, errores de API y referencias cruzadas de base de datos.

### Formato de ID
```
[prefijo]_[ksuid_base62]
```

### Prefijos de Entidades Oficiales
- Usuario: `usr_`
- Producto: `prd_`
- Pedido/Orden: `ord_`
- Categoría: `cat_`
- Transacción de Pago: `pay_`
- Inventario: `inv_`
- Evento del sistema: `evt_`

### Ejemplo Práctico
Un identificador de pedido se verá así:
`ord_1yY4HhR4n2yG8mZ9zS5wV3u8X7e`

---

## 3. Convenciones de DynamoDB

Para maximizar el rendimiento y la escalabilidad de la base de datos de proStore, utilizaremos un diseño de **Tabla Única (Single-Table Design)** en DynamoDB. Esto minimiza el número de conexiones TCP abiertas por las Lambdas y permite realizar consultas multientidad en un solo viaje de ida y vuelta a la base de datos (Query).

### Estructura de Llaves Genéricas
La tabla principal en DynamoDB se definirá con nombres de atributos de llave completamente genéricos para soportar polimorfismo de datos:

- **Partition Key (`PK`)**: String (HASH)
- **Sort Key (`SK`)**: String (RANGE)

### Definición de Atributos de Indexación
Para consultas alternas, definiremos un índice secundario global genérico:
- **GSI1PK**: String (HASH)
- **GSI1SK**: String (RANGE)

### Nombres y Prefijos en Base de Datos
Cada entidad debe estructurar su `PK` y `SK` utilizando los prefijos en mayúsculas de su nombre de dominio seguidos de `#`:

| Entidad | Patrón PK | Patrón SK | Uso / Propósito |
| :--- | :--- | :--- | :--- |
| **User (Metadatos)** | `USER#<userId>` | `METADATA` | Información base del usuario |
| **User (Sesión/Token)**| `USER#<userId>` | `SESSION#<sessionId>` | Sesiones activas del usuario |
| **Product (Detalle)** | `PRODUCT#<productId>` | `METADATA` | Información general del producto |
| **Order (Encabezado)** | `ORDER#<orderId>` | `METADATA` | Información de la orden |
| **Order (Ítem comprado)**| `ORDER#<orderId>` | `ITEM#<productId>` | Relación de productos en una orden |

### Ejemplo de Modelado (Single-Table)
```
PK                   | SK               | entity    | name             | email            | total
--------------------------------------------------------------------------------------------------
USER#usr_123         | METADATA         | User      | John Doe         | john@example.com | NULL
PRODUCT#prd_999      | METADATA         | Product   | Zapatos Running  | NULL             | NULL
ORDER#ord_777        | METADATA         | Order     | NULL             | NULL             | 150.00
ORDER#ord_777        | ITEM#prd_999     | OrderItem | NULL             | NULL             | NULL
```

### Buenas Prácticas
1. **No usar LSIs**: Limitan la escalabilidad del tamaño de la partición (máximo 10 GB por Partition Key). Usar únicamente GSIs.
2. **Sparse Indexes (Índices Dispersos)**: Si un ítem no contiene el atributo configurado como `GSI1PK`, DynamoDB no lo indexará en el GSI1. Utilizaremos esta característica para implementar filtrados eficientes (ej: indexar solo ítems no borrados o ítems marcados como destacados).

---

## 4. Convenciones de Fechas

Cualquier campo de fecha en la plataforma debe registrarse bajo estándares rigurosos que eviten discrepancias horarias entre servidores de AWS, bases de datos y clientes en diferentes husos horarios.

### Estándar Oficial
- **Formato**: ISO 8601 ampliado con milisegundos y forzado a la zona horaria UTC (sufijo `Z`).
- **Codificación**: String / Varchar UTF-8.
- **Expresión Regular de Validación**: `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`

### Atributos de Fecha Requeridos
- `createdAt`: Registra la fecha de inserción original del registro. Nunca debe ser modificado tras el guardado.
- `updatedAt`: Registra la fecha del último cambio del ítem. Debe actualizarse obligatoriamente en toda operación de modificación.
- `deletedAt`: Registra la fecha de borrado lógico. Permanecerá en `null` mientras el registro esté activo.
- `publishedAt`: Indica la fecha y hora a partir de la cual un producto, promoción o campaña se vuelve visible en la tienda.
- `expiresAt`: Utilizado para el TTL (Time to Live) automático de DynamoDB. **Importante**: DynamoDB requiere que el TTL esté guardado en formato **Unix Epoch Timestamp en segundos (número)**.

### Ejemplos Prácticos
- Atributo estándar (createdAt/updatedAt): `"2026-07-15T17:40:15.123Z"`
- Atributo TTL (expiresAt): `1784137215` *(Número entero que representa los segundos transcurridos desde el 1 de enero de 1970)*.

---

## 5. Convenciones de Estados

Para evitar el uso de booleanos ambiguos (ej: `isEnabled`, `isOk`), todas las entidades de proStore gestionarán su ciclo de vida mediante un atributo explícito llamado `status`.

### Listado de Estados Oficiales y su Semántica
- **DRAFT**: Registro en borrador. Visible únicamente por administradores o creadores en el panel interno. No expuesto a clientes finales.
- **PUBLISHED**: Registro activo y expuesto al público general (ej: productos en catálogo, promociones vigentes).
- **ACTIVE**: Entidad completamente funcional y habilitada en el sistema (ej: cuentas de usuario, transportistas activos).
- **INACTIVE**: Entidad deshabilitada temporalmente por el administrador o el sistema. Bloquea su uso pero preserva su configuración.
- **ARCHIVED**: Histórico de lectura. La entidad ya no se utiliza comercialmente pero debe conservarse para no alterar estadísticas o reportes financieros históricos. Es de solo lectura.
- **DELETED**: Estado que representa un borrado lógico definitivo en el flujo de negocio del sistema.
- **BLOCKED**: Cuenta de usuario restringida debido a sospechas de fraude, violaciones de términos o fallos repetidos de autenticación.
- **PENDING**: Pendiente de una acción de confirmación (ej: pedido pendiente de pago, usuario con email pendiente de verificar).

### Diagrama de Transición de Estados
Las transiciones de estado deben ser validadas en el servicio de dominio antes de ser persistidas en base de datos.
```
[DRAFT] ───► [PUBLISHED] ───► [ARCHIVED]
   │              │
   ▼              ▼
[INACTIVE] ──► [DELETED]
```

---

## 6. Versionado

La integridad y consistencia de los datos en entornos concurrentes y distribuidos como AWS Lambda requiere mecanismos de control para evitar la sobreescritura accidental de datos (pérdida de actualizaciones).

### A. Versionado de Registros (Optimistic Locking)
- Cada ítem en la base de datos de DynamoDB contará con un campo entero obligatorio llamado `version`.
- Al crear el registro, `version` se inicializa en `1`.
- En cada actualización, se debe realizar una escritura condicional en DynamoDB validando que la versión en la base de datos sea igual a la versión leída originalmente por la Lambda, incrementando simultáneamente el valor en 1:
  ```json
  ConditionExpression: "version = :expectedVersion"
  UpdateExpression: "SET ..., version = version + :increment"
  ```
- Si la condición falla (DynamoDB arroja `ConditionalCheckFailedException`), el repositorio debe atrapar el error y lanzar una excepción de negocio de tipo `CONFLICT` indicando que el registro ha sido modificado por otro proceso en paralelo.

### B. Versionado de APIs
- **Control en Ruta**: Las rutas públicas expuestas en API Gateway incluirán el prefijo de versión mayor en la URL:
  - `/v1/products`
  - `/v2/products`
- **Regla de Cambio**: Solo se incrementará la versión de la API ante cambios incompatibles (breaking changes) en el contrato JSON de entrada o salida. Cambios aditivos (campos nuevos) no requieren nueva versión de la API.

### C. Versionado de Entidades (Esquemas de Datos)
- Los payloads de DynamoDB pueden cambiar su estructura con los años. Para gestionar esto de forma limpia sin migraciones costosas de toda la tabla, incluiremos un atributo `schemaVersion` (número entero).
- Al recuperar un ítem, el adaptador de base de datos lee `schemaVersion`. Si es una versión antigua, se aplica una función transformadora (Upcast) antes de entregar la entidad al servicio de negocio.

---

## 7. Soft Delete (Borrado Lógico)

En plataformas de comercio electrónico enterprise, **está estrictamente prohibido realizar eliminaciones físicas (`DELETE`) de registros de negocio en la base de datos de producción**, salvo por peticiones explícitas de leyes de privacidad (como GDPR) tras la anonimización de datos.

### Razón Técnica e Histórica
- **Integridad de Datos**: Si eliminas físicamente a un usuario que realizó un pedido en 2024, las tablas de pedidos tendrán llaves foráneas inválidas y los reportes financieros anuales fallarán.
- **Auditoría Forense**: Permite recuperar información eliminada por error y rastrear accesos sospechosos o sabotaje interno.

### Implementación del Borrado Lógico
Para borrar un registro:
1. Cambiar el atributo `status` a `"DELETED"`.
2. Establecer `isDeleted` como `true`.
3. Rellenar `deletedAt` con la marca de tiempo UTC actual.
4. Rellenar `deletedBy` con el ID del usuario o proceso ejecutor.
5. **Remoción de Atributos de Indexación**: Se deben eliminar del ítem los atributos `GSI1PK` y `GSI1SK`. Esto provoca que DynamoDB lo remueva del índice secundario de forma automática, evitando que registros borrados afecten al rendimiento de las búsquedas de catálogo activo.

### Consultas
Las queries del catálogo activo o listados funcionales siempre deben filtrar usando la condición `isDeleted = false` (o buscando únicamente en GSIs donde el registro borrado ya no está presente).

### Restauración
Si se requiere restaurar el registro, el sistema pondrá `isDeleted = false`, `deletedAt = null`, `deletedBy = null` y recalculará los valores de indexación `GSI1PK`/`GSI1SK` basados en su estado funcional actual.

---

## 8. Auditoría

Para garantizar el cumplimiento normativo (SOC 2, ISO 27001) y la rastreabilidad de los datos, todo registro guardado en la base de datos de proStore debe contener de forma obligatoria el siguiente bloque homogéneo de metadatos de auditoría:

```json
{
  "id": "prd_01f8me553m0000000000000000",
  "entity": "Product",
  "version": 1,
  "createdAt": "2026-07-15T17:40:15.123Z",
  "createdBy": "usr_01f8me553m0000000000000001",
  "updatedAt": "2026-07-15T17:40:15.123Z",
  "updatedBy": "usr_01f8me553m0000000000000001",
  "deletedAt": null,
  "deletedBy": null
}
```

### Justificación de Campos
- **`entity`**: Permite filtros analíticos inmediatos sobre la tabla única de DynamoDB.
- **`createdBy` / `updatedBy`**: Almacena el identificador del causante del cambio. Permite saber qué administrador modificó un precio o qué cliente canceló una orden. Si la acción fue automática, se registrará `"system_processor"`.

---

## 9. Eventos del Sistema

La arquitectura reactiva e integrada de proStore confía en EventBridge como el cerebro de comunicación. Las Lambdas no realizan llamadas directas de acoplamiento a otras Lambdas para procesos complementarios; en su lugar, publican eventos.

### Convención de Nombres de Eventos
Los eventos de dominio siguen la estructura jerárquica:
```
[DOMINIO].[ENTIDAD].[ACCION]
```
- Siempre en **mayúsculas**.
- El dominio representa el contexto delimitado (ej: `CATEGORY`, `PRODUCT`, `ORDER`, `PAYMENT`, `INVENTORY`).

### Listado de Eventos Estándar
- `CATEGORY_CREATED`: Emitido al crear una nueva categoría.
- `PRODUCT_UPDATED`: Emitido cuando se modifican metadatos o precios de un producto.
- `ORDER_PAID`: Emitido cuando pasarelas de pago confirman el cobro exitoso de un pedido.
- `PAYMENT_FAILED`: Emitido ante fallos de cobro de tarjetas.
- `INVENTORY_LOW_STOCK`: Emitido cuando la cantidad física de un producto cae por debajo del umbral de alerta.

### Estructura de Payload Estándar
Los eventos enviados al bus de EventBridge tendrán el formato:
```json
{
  "Source": "prostore.orders",
  "DetailType": "ORDER_PAID",
  "Detail": JSON.stringify({
    "metadata": {
      "eventId": "evt_01f8me553m0000000000000009",
      "correlationId": "corr_77777777-7777-7777-7777-777777777777",
      "timestamp": "2026-07-15T17:45:00.000Z",
      "actor": "usr_123"
    },
    "data": {
      "orderId": "ord_999",
      "totalAmount": 150.00,
      "currency": "USD"
    }
  })
}
```

---

## 10. Convenciones para Slugs

Los slugs son las representaciones textuales simplificadas de nombres de productos, categorías o marcas legibles para humanos y optimizados para motores de búsqueda (SEO).

### Reglas de Generación y Normalización
1. **Minúsculas**: Todo slug debe ser convertido estrictamente a caracteres en minúscula.
2. **Sin Acentos ni Caracteres Especiales**: Reemplazar letras con diacríticos (á -> a, é -> e, ñ -> n) y eliminar símbolos no alfanuméricos.
3. **Separador Único**: Reemplazar espacios y caracteres de puntuación por guiones medios (`-`). Nunca guiones bajos (`_`) ni múltiples guiones consecutivos.
4. **URL Safe**: Eliminar cualquier carácter prohibido en URLs.

### Ejemplos Prácticos
- Original: `¡Zapatos de Fútbol Nike Mercurial (Talla 42)!`  
  Slug: `zapatos-de-futbol-nike-mercurial-talla-42`
- Original: `Tecnología & Computación`  
  Slug: `tecnologia-computacion`

### Multiidioma
Si la plataforma soporta múltiples localizaciones, la entidad almacenará un mapa de slugs en base a la configuración regional:
```json
{
  "slugs": {
    "es": "zapatos-de-correr-premium",
    "en": "premium-running-shoes"
  }
}
```

---

## 11. Convenciones de Nombres

El código debe leerse como un libro continuo. Mantenemos reglas estrictas para nomenclatura de archivos y código para asegurar coherencia entre múltiples repositorios y desarrolladores.

### A. Reglas Generales de Código
- **Variables / Funciones**: `camelCase` (ej: `getProductById`, `invoiceAmount`).
- **Clases**: `PascalCase` (ej: `PaymentProcessor`, `DynamoClient`).
- **Constantes / Enums**: `UPPER_SNAKE_CASE` (ej: `MAX_RETRIES`, `ORDER_STATUS`).
- **Tipos / Interfaces**: `PascalCase` terminados en su tipo lógico o contexto (ej: `ProductAttributes`, `OrderPayload`).

### B. Estructura de Componentes en Código
- **Handlers (Controladores Lambda)**: `camelCase` terminados en `Handler.js` (ej: `createOrderHandler.js`).
- **Services (Casos de Uso)**: `PascalCase` terminados en `Service.js` (ej: `OrderService.js`).
- **Repositories (Data Access)**: `PascalCase` terminados en `Repository.js` (ej: `ProductRepository.js`).
- **DTOs (Data Transfer Objects)**: `PascalCase` terminados en `DTO.js` (ej: `CreateUserDTO.js`).

### C. Nombre de Recursos de AWS (Lambdas)
Para facilitar la administración en la consola de AWS, las funciones Lambda seguirán la estructura:
```
prostore-[stage]-[boundedContext]-[domain]-[action]
```
- **Ejemplo**: `prostore-dev-orders-checkout-create`

---

## 12. Convenciones de Respuestas API

Todas las APIs HTTP expuestas por proStore a través de API Gateway responderán obligatoriamente bajo un formato estructurado idéntico. Los clientes frontend (React + Vite, Apps móviles) deben poder predecir el esquema de respuesta sin importar el endpoint consumido.

### Estructura de Respuesta Exitosa (200 OK / 201 Created)
```json
{
  "success": true,
  "data": {
    "id": "prd_01f8me553m0000000000000000",
    "name": "Zapatos de Cuero Classic",
    "price": 89.99
  },
  "meta": {
    "timestamp": "2026-07-15T17:40:15.123Z",
    "traceId": "apg-999999-xxxx"
  }
}
```

### Estructura de Respuesta Errónea (4xx / 5xx)
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Los datos de entrada contienen errores de validación.",
    "details": [
      {
        "field": "price",
        "message": "El precio debe ser un número positivo."
      }
    ]
  },
  "meta": {
    "timestamp": "2026-07-15T17:40:15.123Z",
    "traceId": "apg-999999-xxxx"
  }
}
```

### Ejemplos Oficiales de Códigos HTTP

- **200 OK (Consulta Exitosa)**:
  ```json
  {
    "success": true,
    "data": { "status": "UP" }
  }
  ```
- **201 Created (Creación Exitosa)**:
  ```json
  {
    "success": true,
    "data": { "id": "usr_999", "email": "new@user.com" }
  }
  ```
- **400 Bad Request (Petición Mal Formada)**:
  ```json
  {
    "success": false,
    "error": {
      "code": "BAD_REQUEST",
      "message": "El cuerpo JSON no es válido."
    }
  }
  ```
- **401 Unauthorized (Autenticación Requerida)**:
  ```json
  {
    "success": false,
    "error": {
      "code": "UNAUTHORIZED",
      "message": "Token de autenticación expirado o ausente."
    }
  }
  ```
- **403 Forbidden (Permisos Insuficientes)**:
  ```json
  {
    "success": false,
    "error": {
      "code": "FORBIDDEN",
      "message": "No tienes los permisos necesarios para realizar esta acción."
    }
  }
  ```
- **404 Not Found (Recurso no Encontrado)**:
  ```json
  {
    "success": false,
    "error": {
      "code": "NOT_FOUND",
      "message": "El producto solicitado no existe."
    }
  }
  ```
- **409 Conflict (Conflicto de Estado / Concurrencia)**:
  ```json
  {
    "success": false,
    "error": {
      "code": "CONFLICT",
      "message": "El registro fue modificado por otro proceso. Inténtalo de nuevo."
    }
  }
  ```
- **422 Unprocessable Entity (Errores de Validación de Esquema)**:
  ```json
  {
    "success": false,
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Datos de entrada inválidos.",
      "details": [
        { "field": "email", "message": "Formato de correo incorrecto." }
      ]
    }
  }
  ```
- **429 Too Many Requests (Límite de Tasa Excedido)**:
  ```json
  {
    "success": false,
    "error": {
      "code": "TOO_MANY_REQUESTS",
      "message": "Límite de peticiones excedido. Intente en 60 segundos."
    }
  }
  ```
- **500 Internal Server Error (Fallo Inesperado de Sistema)**:
  ```json
  {
    "success": false,
    "error": {
      "code": "INTERNAL_ERROR",
      "message": "Ha ocurrido un error inesperado en nuestro servidor."
    }
  }
  ```

---

## 13. Convenciones de Errores

El manejo de errores en proStore no debe delegarse a excepciones no controladas de Node.js. Implementamos una jerarquía tipada orientada al negocio.

### Jerarquía de Excepciones
Todas las excepciones personalizadas del backend heredan de la clase base `AppError`:

1. **`AppError` (Base)**: Extiende la clase `Error` de JS. Almacena `statusCode`, `code`, y un array de `details`.
2. **`BusinessError` (Errores de Regla de Negocio)**: Lanzado cuando una regla de dominio falla (ej: intentar comprar un producto sin stock). Código HTTP sugerido: `400` o `422`.
3. **`ValidationError` (Errores de Entrada)**: Lanzado por los validadores de esquema (Joi/Zod). Código HTTP: `422`.
4. **`InfrastructureError` (Errores de Adaptadores Externos)**: Lanzado cuando falla una llamada a DynamoDB, S3, Cognito o APIs externas. Código HTTP: `500`.
5. **`SecurityError` (Errores de Autenticación/Autorización)**: Lanzado ante firmas inválidas de JWT, tokens expirados o accesos a recursos ajenos. Código HTTP: `401` o `403`.

### Trazabilidad (TraceId y CorrelationId)
- **`traceId`**: Identificador único generado por API Gateway por cada petición HTTP HTTP. Debe extraerse en el handler de entrada y propagarse en todos los logs de ejecución.
- **`correlationId`**: Si una petición desencadena un proceso asíncrono (ej: EventBridge -> SQS -> Lambda secundaria), el `correlationId` original de la petición debe inyectarse en los metadatos del evento para poder rastrear el flujo completo a través de múltiples Lambdas independientes.

---

## 14. Logging

El logueo descuidado en texto plano dificulta las auditorías y búsquedas avanzadas en CloudWatch Logs. En proStore, todos los logs se emiten obligatoriamente en formato **JSON estructurado** de una sola línea.

### Estructura de Log Oficial
```json
{
  "timestamp": "2026-07-15T17:40:15.123Z",
  "level": "INFO",
  "message": "Usuario autenticado exitosamente",
  "traceId": "apg-999999-xxxx",
  "correlationId": "corr-7777777-yyyy",
  "domain": "Authentication",
  "context": {
    "userId": "usr_999",
    "ipAddress": "192.168.1.1"
  }
}
```

### Niveles de Logs
- **DEBUG**: Informacion exhaustiva de desarrollo (ej: dumps de variables, payloads de bases de datos antes de ser filtrados). Deshabilitado por defecto en producción.
- **INFO**: Eventos del ciclo de vida normal de la aplicación (ej: inicio de peticiones, actualizaciones de pedidos, transiciones de estados válidas).
- **WARN**: Advertencias sobre anomalías que no detienen el servicio pero deben ser monitoreadas (ej: llamadas fallidas a caché con fallback a base de datos, intentos fallidos de login).
- **ERROR**: Fallos críticos que detienen la petición o el hilo de ejecución (ej: caídas de bases de datos, excepciones no controladas de infraestructura, errores de validación de firma).

---

## 15. Seguridad

La protección de los datos de los clientes y las llaves del sistema es una prioridad absoluta de la arquitectura.

### Reglas Críticas de Seguridad
1. **Encriptación en Todo Nivel**:
   - Datos en tránsito protegidos mediante HTTPS (TLS 1.3 mínimo) a nivel de API Gateway y CloudFront.
   - Datos en reposo en DynamoDB y S3 encriptados usando llaves KMS gestionadas por AWS.
2. **Principio de Mínimo Privilegio (IAM)**:
   - Cada función Lambda tendrá su propio rol IAM individualizado.
   - Está estrictamente prohibido usar políticas comodín (`*`) en permisos de recursos o acciones (ej: prohibido otorgar `dynamodb:*` a recursos `*`). Cada rol debe detallar las acciones específicas (`GetItem`, `PutItem`) y los ARNs de los recursos específicos (el ARN exacto de la tabla).
3. **Manejo de Secretos**:
   - Nunca escribir contraseñas, tokens de API o certificados directamente en el código fuente ni en el archivo `.env` en entornos de producción.
   - En producción, los secretos de configuración se leen de forma dinámica desde **AWS Secrets Manager** o **AWS Systems Manager Parameter Store** con cache local para evitar latencias.
4. **Sanitización de Datos**:
   - Toda entrada de usuario debe ser sanitizada para evitar ataques de inyección y XSS (Cross-Site Scripting).
   - Ocultación automática de datos sensibles (números de tarjeta de crédito completos, contraseñas, tokens) en los logs mediante máscaras en las funciones auxiliares de logging.

---

## 16. Checklist Obligatorio para Nuevos Módulos

Antes de aprobar el merge o despliegue de cualquier nuevo módulo, función Lambda o cambio arquitectónico en proStore, se debe verificar el cumplimiento del siguiente checklist técnico:

- [ ] **Cumplimiento de IDs**: Todas las entidades nuevas usan KSUIDs con el prefijo oficial asignado.
- [ ] **Single-Table Design**: El mapeo de base de datos se realiza sobre la tabla unificada usando `PK` y `SK` genéricos.
- [ ] **Campos de Auditoría**: La entidad cuenta con `createdAt`, `updatedAt`, `deletedAt`, `createdBy`, `updatedBy`, `deletedBy`, `version` y `entity`.
- [ ] **Manejo Condicional de Versión**: Las escrituras de actualización implementan Optimistic Locking utilizando el atributo `version`.
- [ ] **Manejo de Errores**: Se capturan las excepciones y se transforman a subclases controladas de `AppError`.
- [ ] **Validación de Peticiones**: Existe un validador de esquema obligatorio para las entradas del handler.
- [ ] **Logs Estructurados**: Los logs se imprimen exclusivamente en formato JSON estructurado incluyendo `traceId` y `correlationId`.
- [ ] **Políticas IAM Mínimas**: El archivo de configuración de infraestructura de la Lambda define permisos exactos y ARNs de recursos específicos.
- [ ] **Pruebas Unitarias**: El nuevo código cuenta con cobertura mínima del 80% en pruebas de lógica de negocio (Servicios y Utilidades).

---

## Resumen Ejecutivo de Decisiones Clave

1. **Paradigma**: Plataforma Serverless Cloud-Native implementada con AWS Lambda bajo arquitectura por capas (Limpia) y diseño conducido por el dominio (DDD).
2. **Identificación**: Uso estricto de KSUIDs base62 antecedidos por el prefijo de la entidad (`[prefijo]_[ksuid]`) para ordenamiento cronológico implícito y fácil lectura.
3. **Persistencia**: DynamoDB Single-Table Design con claves primarias abstractas `PK` y `SK`. Índices GSIs genéricos dispersos para optimizar almacenamiento y velocidad.
4. **Respuestas**: Formato estándar JSON unificado con envoltura `{ success, data, meta }` para éxitos y `{ success, error: { code, message, details }, meta }` para errores.
5. **Logs**: Logs JSON estructurados nativos para fácil indexación en AWS CloudWatch Logs e integraciones de análisis.
