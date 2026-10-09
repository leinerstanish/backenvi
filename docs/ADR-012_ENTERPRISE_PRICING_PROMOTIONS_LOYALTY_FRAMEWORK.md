# ARCHITECTURE DECISION RECORD (ADR-012)
## ENTERPRISE PRICING, PROMOTIONS & LOYALTY FRAMEWORK

**Estado:** APROBADO  
**Contexto:** Desacoplamiento de Reglas de Descuentos, Precios Dinámicos Multicanal y Fidelización Serverless  
**Arquitecto:** Principal Commerce Architect (Especialista en Motores de Reglas, B2B Pricing & Loyalty)  
**Versión:** 1.0.0  

---

## CAPÍTULO 1: Filosofía del Framework

### ¿Por qué Pricing debe estar desacoplado del Catálogo?
El catálogo (`Product` y `ProductVariant` - ADR-003) representa la estructura y atributos inmutables del inventario físico o digital (ej: talla, color, marca, SKU). El precio, por el contrario, es altamente volátil, dinámico y contextual. Un mismo SKU puede tener precios diferentes según la sucursal, la moneda, el canal (B2B vs B2C), el segmento del cliente (VIP vs regular) o la hora del día. Acoplar el precio al catálogo obliga a reescribir e invalidar registros de productos constantemente, rompiendo la consistencia de los datos transaccionales.

### ¿Por qué Product nunca debe calcular descuentos?
La entidad `Product` carece del contexto de compra necesario para computar un descuento. Determinar si un cliente califica para un descuento requiere evaluar la composición actual del carrito, el historial transaccional del usuario, sus puntos de fidelización, el método de pago elegido y las promociones vigentes concurrentes. El producto debe limitarse a reportar su precio base; el cálculo de tarifas finales es responsabilidad exclusiva del `Pricing & Promotion Engine`.

### ¿Por qué Checkout nunca debe contener reglas comerciales de descuento?
El proceso de `Checkout` es una máquina de estado transaccional crítica encargada de validar stock, capturar envíos y delegar pagos. Incluir reglas comerciales directamente en el código de checkout (ej: condicionales cableados `if (cartTotal > 100) discount = 10`) genera una deuda técnica masiva e inestabilidad en las compras. El checkout consume el resultado consolidado del motor de precios y promociones como una API de solo lectura inmutable, asegurando la separación estricta de responsabilidades (Clean Architecture).

---

## CAPÍTULO 2: Arquitectura General (Flujo de Resolución)

El motor procesa el precio del carrito a través de una tubería de resolución secuencial determinística:

```
[1. Catálogo (SKU)] ──> Recupera precio base del producto
            │
            ▼
[2. Pricing Engine] ──> Aplica tarifas B2B, regionales y listas personalizadas
            │
            ▼ (Precio de Lista del Contexto)
[3. Promotion Engine] ──> Evalúa promociones activas (Combos, 2x1, Flash Sales)
            │
            ▼ (Precio Promocional)
[4. Loyalty Engine] ──> Evalúa multiplicador de puntos y descuentos por Nivel
            │
            ▼ (Precio Fidelizado)
[5. Coupons Engine] ──> Valida e inyecta cupones de descuento manuales
            │
            ▼ (Precio con Descuento)
[6. Gift Cards & Credits] ──> Aplica saldos de tarjetas y créditos de tienda
            │
            ▼ (Precio Neto Final a Pagar)
[7. Checkout Engine] ──> Genera la orden con el desglose de amortización
```

---

## CAPÍTULO 3: Modelo de Dominio de Precios y Beneficios

Modelamos 20 entidades nucleares en la base de datos única de DynamoDB (ADR-002):

1. **PRICE_LIST**: Catálogo maestro de listas de precios (ej: "Tarifas Mayoristas Colombia").
2. **PRICE**: Tarifa numérica asignada a un SKU dentro de una lista de precios.
3. **PRICE_RULE**: Condiciones de asignación de una lista de precios a un cliente o canal.
4. **PROMOTION**: Definición de una campaña de descuento (ej: "Black Friday 2026").
5. **PROMOTION_RULE**: Reglas lógicas individuales asociadas a una campaña.
6. **PROMOTION_CONDITION**: Criterios de evaluación para activar la promoción.
7. **PROMOTION_ACTION**: El efecto de descuento resultante (ej: restar 15% al total).
8. **COUPON**: Código de descuento alfanumérico que invoca una promoción.
9. **COUPON_BATCH**: Lote de generación de cupones masivos únicos para campañas.
10. **GIFT_CARD**: Tarjeta de regalo con saldo virtual prepagado.
11. **STORE_CREDIT**: Balance a favor del cliente utilizable como dinero en efectivo.
12. **LOYALTY_PROGRAM**: Reglas de fidelización generales del inquilino SaaS.
13. **LOYALTY_LEVEL**: Niveles del programa (Bronze, Silver, Gold, Platinum, Diamond).
14. **LOYALTY_POINTS**: Saldo de puntos activos acumulados del cliente.
15. **LOYALTY_TRANSACTION**: Historial inmutable de abonos/débitos de puntos.
16. **REWARD**: Catálogo de beneficios canjeables por puntos.
17. **CAMPAIGN**: Agrupador gerencial de promociones y cupones.
18. **PRICING_CONTEXT**: Objeto efímero de entrada con los datos del carrito y cliente.
19. **PRICE_HISTORY**: Auditoría histórica de cambios de tarifas del SKU.
20. **PROMOTION_HISTORY**: Registro transaccional de qué promociones se aplicaron a cada orden.

---

## CAPÍTULO 4: Motor de Precios y Jerarquía de Resolución

El motor soporta variaciones complejas de tarifas:

- **Dimensiones de Precio**:
  - *Precio por Región/Moneda*: Conversión e indexación nativa de listas en USD, COP, EUR para evitar discrepancias de cambio.
  - *Precio B2B / Mayorista*: Descuentos por volumen segmentados mediante listas de precios exclusivas asociadas a la cuenta corporativa del cliente.
  - *Precio Temporal*: Tarifas promocionales con marcas de tiempo de inicio y fin que se activan automáticamente sin modificar el precio base.
- **Jerarquía de Resolución de Precios (De menor a mayor precedencia)**:
  1. Base Price (Precio de Catálogo).
  2. Channel Price (Precio asignado al canal de venta actual, ej. App Móvil).
  3. Regional Price (Precio asignado a la ubicación geográfica detectada).
  4. Segment Price (Precio asignado al segmento del cliente, ej. VIP).
  5. Account-Specific Price (Precio negociado B2B exclusivo para la empresa del cliente).

---

## CAPÍTULO 5: Motor de Promociones y Acciones Comerciales

Mapeamos los comportamientos de promociones requeridos a nivel de middleware:

- **Porcentaje / Valor Fijo**: Descuento directo (ej: -10% o -$20) al ítem o total del carrito.
- **Mecánicas de Volumen (2x1, 3x2, BOGO - Buy One Get One)**: Descuento aplicado al ítem de menor valor del mismo SKU o categoría.
- **Combos, Packs & Bundles**: Descuento condicionado a la compra conjunta de múltiples SKUs predefinidos (ej: Cámara + Lente + Trípode por un precio fijo consolidado).
- **Regalo Automático (GWP - Gift with Purchase)**: Añade un SKU de regalo de forma automática al carrito si se cumple un monto mínimo de compra.

---

## CAPÍTULO 6: Condiciones de Activación (Rule Evaluation)

La activación de promociones y precios se restringe mediante condiciones evaluadas en caliente:

- **Condiciones Geográficas**: Restringe campañas a ciudades o países específicos basados en la dirección de envío del checkout.
- **Condiciones Temporales**: Reglas horarias estrictas (Happy Hour) adaptadas a la zona horaria del cliente.
- **Condiciones de Comportamiento**: Habilita descuentos exclusivos para la "Primera Compra" del usuario o basados en su historial (ej: no haber comprado en los últimos 60 días).

---

## CAPÍTULO 7: Gestión de Cupones

- **Unidades Únicas de Uso**: Generación de códigos aleatorios de un solo uso enlazados al identificador del cliente (`userId`), previniendo fugas masivas en foros de ofertas.
- **Generación Masiva (Bulk Coupon Generator)**: Capacidad para generar lotes de 1 millón de cupones únicos exportables para integraciones con plataformas de marketing (ej: HubSpot, Klaviyo).
- **Límites de Uso y Frecuencia**: Restricción del total de redenciones globales (ej: "Válido para los primeros 500 canjes").

---

## CAPÍTULO 8: Tarjetas de Regalo (Gift Cards)

- **Saldos Recargables**: Las tarjetas actúan como cuentas prepago. El saldo (`balance`) se almacena cifrado y cuenta con historial inmutable de movimientos.
- **Canje Parcial y Bloqueos**: El cliente puede consumir fracciones del saldo en múltiples compras. Soporta estados de `LOCKED` (bloqueado preventivamente ante sospecha de fraude) y `EXPIRED` (expiración de saldo no consumido).

---

## CAPÍTULO 9: Store Credits (Créditos de Tienda)

- **Emisión en Devoluciones (Refund to Credit)**: En lugar de reembolsar dinero a tarjetas de crédito (con altos costos financieros y operativos), el sistema emite automáticamente Store Credits al cliente por el valor de la devolución.
- **Compensación al Cliente**: Los agentes de soporte pueden abonar Store Credits directamente al cliente como compensación ante incidentes de entrega (ej: pedido retrasado o dañado).

---

## CAPÍTULO 10: Plataforma de Fidelización (Loyalty)

- **Niveles de Fidelidad (Tiers)**:
  - **Bronze**: Multiplicador de puntos `1.0x`. Acceso a preventas básicas.
  - **Silver**: Multiplicador de puntos `1.2x`. Envío gratis en órdenes mayores a $50.
  - **Gold**: Multiplicador de puntos `1.5x`. Soporte prioritario.
  - **Platinum**: Multiplicador de puntos `1.8x`. Regalos exclusivos de aniversario.
  - **Diamond**: Multiplicador de puntos `2.0x`. Asesor de compras personalizado.
- **Loyalty Transactions**: Los puntos acumulados se guardan de forma transaccional inmutable. El cambio de nivel se calcula en caliente ante cada compra que cruce el umbral de puntos requerido.

---

## CAPÍTULO 11: Motor de Reglas (Rule Engine Core)

Para solucionar colisiones entre múltiples promociones concurrentes en el carrito, implementamos resolución determinística:

- **Resolución de Conflictos**:
  - *Prioridad de la Promoción*: Cada campaña cuenta con un peso o valor de prioridad (`priority` de 1 a 100).
  - *Exclusividad vs Acumulación*: Las promociones se marcan con la bandera `isStackable`. Si se introduce una promoción no acumulable, el motor compara el beneficio final de ambas y aplica únicamente la de mayor beneficio para el cliente.
  - *Límite de Descuento Máximo*: Restricción a nivel de configuración del carrito para impedir que la combinación de múltiples descuentos reduzca el precio del producto por debajo de su costo de adquisición unitario.

---

## CAPÍTULO 12: Eventos del Pricing, Promotions & Loyalty Framework

Definimos los eventos de integración asociados a este dominio:

### 1. **`LOYALTY.POINTS_GRANTED`**
- *Publisher*: `Loyalty Engine`
- *Consumidores*: `Notification Hub`, `Customer Profile Service` (Prioridad: Alta)
- *Payload*: `{ "userId": "usr_999", "points": 150, "reason": "PURCHASE", "transactionId": "pay_888" }`

### 2. **`COUPON.REDEEMED`**
- *Publisher*: `Coupon Engine`
- *Consumidores*: `Analytics Service`, `Campaign Audit Service` (Prioridad: Media)

### 3. **`GIFT_CARD.CREATED`**
- *Publisher*: `Gift Card Engine`
- *Consumidores*: `Notification Hub (Envío de código de tarjeta cifrada)` (Prioridad: Alta)

---

## CAPÍTULO 13: Analytics del Margen y Descuentos

Registramos indicadores analíticos para salvaguardar la rentabilidad del negocio:

- **Desglose de Impacto Financiero**: Medición del porcentaje de pedidos que contienen descuentos frente a pedidos a precio regular.
- **ROI de Campaña**: Relación entre el costo total de los descuentos otorgados en una promoción frente al volumen de facturación adicional atraído por la campaña.

---

## CAPÍTULO 14: Optimización Inteligente con Amazon Bedrock

- **Dynamic Pricing Predictivo**: Algoritmos entrenados analizan la demanda histórica de SKUs en tiempo real y sugieren de forma automática rebajas temporales controladas para liquidar inventarios de baja rotación.
- **Simulador Económico IA**: Bedrock analiza una propuesta de promoción (ej: 20% de descuento en Calzado) y estima la pérdida potencial de margen neto y el aumento estimado en la tasa de conversión basándose en históricos de campañas similares.

---

## CAPÍTULO 15: Seguridad y Auditoría de Precios

- **Aprobaciones de Listas de Precios**: Cambios mayores a 15% en listas de precios o creación de promociones masivas requieren flujo de aprobación de dos firmas (*Two-Man Rule*) gestionado mediante Cognito Groups.
- **Historial de Precios Inmutable**: Cada cambio de precio de lista registra el operador responsable, la fecha exacta y el valor anterior para auditorías de cumplimiento ante reguladores de precios y comercio.

---

## CAPÍTULO 16: Observabilidad y Tiempos de Respuesta

- **Regla de Evaluación Máxima**: Las evaluaciones complejas del carrito (cruzar 100 promociones vigentes contra 50 ítems del carrito) deben resolverse en menos de **50ms** para evitar demoras en la experiencia de compra.
- **Métricas de Latencia**: CloudWatch monitoriza los tiempos de procesamiento del Rule Engine por tamaño de carrito.

---

## CAPÍTULO 17: Escalabilidad del Motor de Reglas

- **Caching Táctico**: Las listas de precios activas y definiciones de promociones se almacenan en caché en memorias rápidas (ej. Redis en tránsito) con invalidación inmediata ante guardados de base de datos.
- **Paginación en Evaluación**: En carritos masivos corporativos (B2B con más de 1,000 líneas), la evaluación de reglas se paraleliza dividiendo el payload en bloques de análisis concurrentes.

---

## CAPÍTULO 18: Roadmap de Implementación

- **Fase 1: Motor de Precios**: Listas de precios base, B2B y regionales.
- **Fase 2: Promociones Básicas**: Descuentos de valor fijo, porcentajes y cupones de campaña.
- **Fase 3: Gift Cards & Store Credits**: Ciclo de tarjetas virtuales de regalo y flujo de créditos para devoluciones.
- **Fase 4: Loyalty Engine**: Niveles, acumulación de puntos por compras y misiones de referido.
- **Fase 5: Rule Engine Dinámico**: Lógica de resolución de colisiones y acumulabilidad avanzada.
- **Fase 6: Dynamic Pricing con IA**: Optimización predictiva de tarifas basada en Amazon Bedrock.

---

## CAPÍTULO 19: Checklist de Descuentos y Tarifas

Toda regla de negocio o descuento introducido a la plataforma debe certificar el cumplimiento de este checklist analítico antes de su despliegue:

- [ ] **Límite de Rentabilidad**: Toda promoción declara un margen de pérdida admisible y un descuento máximo acumulado aplicable por orden.
- [ ] **Auditoría de Modificaciones**: Los cambios en listas de precios generan un evento de auditoría `PRICE_UPDATED` detallando el operador de origen.
- [ ] **Contrato de Solo Lectura**: La lógica transaccional de cobros no altera las definiciones del motor de reglas, limitándose a consumir el resultado matemático.
- [ ] **Compatibilidad de Moneda**: Las promociones de valor fijo restringen su aplicación a la moneda correspondiente a la transacción del carrito.
