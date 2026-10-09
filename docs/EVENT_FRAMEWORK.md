# GUÍA DE DESARROLLO: ENTERPRISE EVENT FRAMEWORK
**Manual Oficial para Creación, Registro, Publicación y Consumo de Eventos**  
**Ubicación del Framework:** `src/shared/events/`  

---

## 1. CÓMO CREAR UN EVENTO NUEVO

Para añadir un nuevo evento al sistema (por ejemplo, `PRODUCT_CREATED`), debes seguir estos 3 pasos obligatorios:

### Paso 1.1: Registrar el nombre del evento
Edita [eventNames.js](file:///Users/leinermena/code/gitlab.com/local/proStore/back/src/shared/events/constants/eventNames.js) y añade la constante del tipo de evento en mayúsculas:

```javascript
const EventNames = {
  // ...
  CATALOG_PRODUCT_CREATED: 'CATALOG.PRODUCT_CREATED', // NUEVO EVENTO
};
```

### Paso 1.2: Crear el JSON Schema del Payload
Crea el archivo de esquema JSON para la versión 1 en la carpeta `schemas/`. Por ejemplo, `src/shared/events/schemas/PRODUCT_CREATED_v1.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ProductCreated_v1",
  "type": "object",
  "properties": {
    "id": { "type": "string", "pattern": "^prd_[a-zA-Z0-9]+$" },
    "name": { "type": "string", "minLength": 1 },
    "price": { "type": "number", "minimum": 0.01 }
  },
  "required": ["id", "name", "price"]
}
```

### Paso 1.3: Registrar el Esquema en el EventRegistry
Edita [eventRegistry.js](file:///Users/leinermena/code/gitlab.com/local/proStore/back/src/shared/events/registry/eventRegistry.js):

1. Importa el archivo JSON del esquema:
   ```javascript
   const productCreatedV1 = require('../schemas/PRODUCT_CREATED_v1.schema.json');
   ```
2. Regístralo en el constructor relacionándolo con el EventName y su versión:
   ```javascript
   this.register(EventNames.CATALOG_PRODUCT_CREATED, 1, productCreatedV1);
   ```

---

## 2. CÓMO PUBLICAR UN EVENTO

Para publicar, **nunca utilices el SDK de AWS directamente**. Utiliza el servicio `eventPublisher` que se encarga de autocompletar el Event Envelope, inyectar telemetría y validar el payload contra el esquema JSON en caliente:

```javascript
const eventPublisher = require('../shared/events/publisher/eventPublisher');
const EventNames = require('../shared/events/constants/eventNames');

await eventPublisher.publish({
  eventName: EventNames.CATALOG_PRODUCT_CREATED,
  eventVersion: 1,
  aggregate: 'Product',
  aggregateId: 'prd_3GYEZpaYnluMjcJv',
  payload: {
    id: 'prd_3GYEZpaYnluMjcJv',
    name: 'Nike Air Zoom',
    price: 120.00
  },
  actor: 'usr_admin_123'
});
```

*Nota: `traceId` y `correlationId` se resuelven automáticamente de forma transparente desde el almacenamiento contextual del logger (`AsyncLocalStorage`).*

---

## 3. CÓMO CREAR UN CONSUMIDOR (Event Consumer)

Todo consumidor de eventos (por ejemplo, el encargado de enviar un email de bienvenida cuando un cliente se registra) debe extender de la clase base `BaseConsumer`:

```javascript
const BaseConsumer = require('../shared/events/consumer/baseConsumer');
const EventNames = require('../shared/events/constants/eventNames');
const logger = require('../utils/logger');

class WelcomeEmailConsumer extends BaseConsumer {
  constructor() {
    // Nombre del consumidor (para logs), Evento esperado, Versión esperada
    super('WelcomeEmailConsumer', EventNames.CUSTOMER_REGISTERED, 1);
  }

  /**
   * Implementación de la lógica de dominio.
   * Se ejecuta automáticamente dentro del contexto de logs del TraceId del evento original.
   */
  async handle(eventEnvelope) {
    const { payload, eventId } = eventEnvelope;
    logger.info(`Enviando correo de bienvenida a: ${payload.email}`);
    
    // Tu llamada al servicio de email (ej: SES)
    await emailService.sendWelcome(payload.email, payload.name);
    
    return { emailSent: true };
  }
}

module.exports = new WelcomeEmailConsumer();
```

---

## 4. GESTIÓN DE NUEVAS VERSIONES (Versioning)

Si los requerimientos del negocio cambian y el payload del evento debe evolucionar de forma rupturista (por ejemplo, añadir un campo obligatorio en `CATEGORY_CREATED`), sigue estas pautas de versionado:

1. **Crear esquema v2**: Crea `CATEGORY_CREATED_v2.schema.json` y regístralo en el `EventRegistry` en la versión `2`:
   ```javascript
   this.register(EventNames.CATALOG_CATEGORY_CREATED, 2, categoryCreatedV2);
   ```
2. **Publicar v2**: Llama a `eventPublisher.publish` incrementando el `eventVersion` a `2`.
3. **Consumidores Existentes**:
   - Los consumidores que esperan la versión `1` no se verán afectados. `BaseConsumer` descartará o enrutará de forma segura el evento según sus suscripciones.
   - Para actualizar un consumidor existente a la versión 2, simplemente modifica su llamada `super(..., 2)` e implementa los cambios en el payload.

---

## 5. BUENAS PRÁCTICAS Y EVITAR ERRORES COMUNES

### 🚨 ERROR: Importar `@aws-sdk/client-eventbridge` en Lambdas de Negocio
**Consecuencia**: Salta las validaciones del esquema JSON y destruye la consistencia de metadatos en la red.
**Corrección**: Importa y usa siempre `eventPublisher` de la carpeta `shared`.

### 🚨 ERROR: No capturar excepciones en el `handle` del consumidor
**Consecuencia**: `BaseConsumer` re-lanza el error para que AWS SQS aplique reintentos y desvíe a la Dead Letter Queue (DLQ). Esto es correcto para errores de red temporales, pero si el payload está corrupto (error de lógica), se generará un bucle de reintentos innecesario.
**Corrección**: Para errores de negocio que sabemos que nunca se solucionarán solos (ej: ID inválido), captura el error y decide si registrar el log y terminar con éxito o re-lanzar si requiere intervención técnica.

### 💡 MEJOR PRÁCTICA: De-duplicación automática
`BaseConsumer` comprueba automáticamente el `eventId` contra el `IdempotencyStore` (que utiliza Upstash Redis con TTL de 7 días). No necesitas escribir validaciones de doble consumo dentro del `handle()`.
