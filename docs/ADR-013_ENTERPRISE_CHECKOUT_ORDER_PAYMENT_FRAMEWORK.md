# ARCHITECTURE DECISION RECORD (ADR-013)
## ENTERPRISE CHECKOUT, ORDER MANAGEMENT & PAYMENT ORCHESTRATION FRAMEWORK

**Estado:** APROBADO  
**Contexto:** Orquestación Transaccional Serverless, Motores de Pago Resilientes y Gestión de Órdenes Multi-bodega (OMS)  
**Arquitecto:** Principal Commerce Architect (Especialista en Checkout, Payment Gateway Routing & OMS)  
**Versión:** 1.0.0  

---

## CAPÍTULO 1: Filosofía del Framework

### ¿Por qué Checkout debe estar desacoplado de Cart?
El carrito (`Cart`) es una entidad efímera de alta frecuencia de lectura y baja criticidad transaccional. Los usuarios añaden y remueven productos constantemente, buscando simular precios o guardar intenciones de compra. El checkout (`Checkout`), en cambio, es una sesión transaccional estricta que congela tarifas, bloquea stock temporalmente, captura datos de envío/facturación auditados y orquesta cobros financieros. Mantenerlos unidos contamina el rendimiento de la base de datos y expone sesiones de cobro a vulnerabilidades lógicas.

### ¿Por qué Order debe ser un Aggregate independiente?
Una orden de compra (`Order`) es un documento legal e histórico inmutable. Una vez creada, debe reflejar exactamente el estado del inventario, precios, impuestos y descuentos de ese instante del tiempo, independientemente de que los productos del catálogo cambien de nombre o se eliminen en el futuro. `Order` encapsula su propio comportamiento transaccional (ej: reembolsos, cancelaciones, despachos) y no debe depender de las mutaciones lógicas del catálogo de productos o carritos.

### ¿Por qué Payment nunca debe depender de un proveedor específico?
Acoplar los cobros a la SDK de una sola pasarela (ej: Stripe) arriesga la operación ante caídas globales o bloqueos de cuenta. Al implementar una capa de abstracción de pagos (*Payment Orchestrator*), CommerceOS maneja reintentos dinámicos en caliente desviando transacciones fallidas de un proveedor a otro automáticamente, asegurando continuidad comercial total y permitiendo negociaciones de comisiones con pasarelas locales.

---

## CAPÍTULO 2: Arquitectura General (Pipeline Transaccional)

El flujo de procesamiento transaccional sigue un pipeline Serverless altamente coordinado:

```
[1. Carrito de Compras] ──> Inicia sesión de Checkout
            │
            ▼
[2. Sesión de Checkout] ──> Valida stock real en Bodegas
            │
            ▼ (Pricing & Promos - ADR-012)
[3. Pricing Engine] ──> Resuelve listas de precios, cupones y puntos
            │
            ▼ (Bloqueo Temporal de Inventario)
[4. Inventory System] ──> Aplica reserva de stock por 15 minutos
            │
            ▼ (Ruteo Dinámico)
[5. Payment Orchestrator] ──> Despacha cargo (Stripe/PayPal/GiftCards)
            │
            ├── (Pago Exitoso) ───────────── (Pago Fallido)
            ▼                                     ▼
[6. Order Aggregate (OMS)]               [Reintenta / Fallback Pasarela]
            │
            ├──> [Shipping Engine] ───────> Cotiza transportadoras (DHL/FedEx)
            ├──> [Notification Hub] ──────> Envía correo de confirmación (ADR-008)
            └──> [Analytics Pipeline] ────> Registra conversión e impacto (ADR-011)
```

---

## CAPÍTULO 3: Modelo de Dominio Transaccional

Diseñamos 29 entidades nucleares para soportar el OMS, Checkout y Orquestador de Pagos en la tabla única:

### Grupo Checkout
1. **CHECKOUT**: Sesión de checkout maestra (ID, estado `OPEN`/`COMPLETED`, usuario).
2. **CHECKOUT_SESSION**: Sesión temporal de pasarela externa (ej. Stripe checkout session id).
3. **CHECKOUT_ITEM**: SKUs, cantidades y tarifas congeladas en la sesión.
4. **CHECKOUT_ADDRESS**: Dirección física asociada a esta sesión de compra.

### Grupo Direcciones y Logística
5. **ADDRESS_BOOK**: Libreta de direcciones guardadas del cliente registrado.
6. **DELIVERY_OPTION**: Modalidades configuradas (Estándar, Express, Recogida).
7. **SHIPPING_METHOD**: Tarifas y tiempos estimados provistos por transportadoras.
8. **CARRIER**: Registro de operadores logísticos (DHL, FedEx, Coordinadora).
9. **SHIPMENT**: Guía y empaque físico asignado a una orden.
10. **SHIPMENT_TRACKING**: Historial de novedades en tránsito reportadas por CDC del carrier.
11. **DELIVERY_ESTIMATE**: Estimaciones de entrega basadas en distancia y stock de bodegas.
12. **DELIVERY_EVENT**: Eventos físicos de entrega reportados en ruta.

### Grupo Gestión de Órdenes (OMS)
13. **ORDER**: Registro maestro inmutable del pedido procesado.
14. **ORDER_ITEM**: Línea de producto comprada, precio unitario facturado y costo fiscal.
15. **ORDER_HISTORY**: Log histórico de transiciones de estados de la orden.
16. **ORDER_TIMELINE**: Eventos visibles al cliente relativos al ciclo de vida del pedido.
17. **ORDER_STATUS**: Estados vigentes y banderas de control operativo.
18. **ORDER_NOTE**: Notas internas de agentes de soporte o comentarios del cliente.
19. **INVOICE**: Factura de venta electrónica timbrada legalmente.
20. **CREDIT_NOTE**: Nota de crédito fiscal emitida ante devoluciones.

### Grupo Orquestación de Pagos
21. **PAYMENT**: Transacción financiera consolidada asociada a la orden.
22. **PAYMENT_ATTEMPT**: Intentos individuales de cobro (permite auditar fallos previos).
23. **PAYMENT_METHOD**: Token o método guardado del cliente para cobros de un solo clic.
24. **PAYMENT_PROVIDER**: Configuración de pasarelas del inquilino SaaS.
25. **PAYMENT_TRANSACTION**: Registros contables crudos del procesador de pagos.

### Grupo Devoluciones
26. **REFUND**: Reembolsos financieros generados al cliente.
27. **RETURN_REQUEST**: Solicitud de devolución de productos iniciada por el cliente.
28. **RETURN_ITEM**: SKUs y cantidades específicas sujetas a devolución y su estado de inspección.
29. **EXCHANGE_REQUEST**: Órdenes de cambio físico generadas por devoluciones aprobadas.

---

## CAPÍTULO 4: Modalidades de Checkout

- **Guest Checkout (Invitado)**: Permite compras rápidas ingresando únicamente el correo electrónico. El sistema crea un perfil efímero que se puede consolidar en cuenta registrada al finalizar la compra.
- **Shared Secure Checkout (Enlace Seguro)**: Generación de URLs seguras firmadas criptográficamente que permiten a agentes de venta telefónica estructurar el carrito y enviarle el enlace de pago listo al cliente por WhatsApp o correo.
- **Checkout Multi-Paso vs One-Click**: Selección dinámica de layouts optimizada por dispositivo. Usuarios registrados cuentan con cobro directo de un solo clic consumiendo métodos tokenizados seguros.

---

## CAPÍTULO 5: Libreta de Direcciones y Validación Geográfica

- **Libreta de Direcciones**: El cliente almacena múltiples direcciones etiquetadas (ej: "Casa", "Oficina") marcando una dirección de envío y facturación predeterminada.
- **Validación y Autocompletado**: Integración con Google Places API para forzar la estandarización de nomenclaturas de calles, guardando latitud/longitud en base de datos para cálculos precisos de distancias hacia bodegas.

---

## CAPÍTULO 6: Logística Avanzada y Split Shipment

- **Split Shipment (Despacho Dividido)**: Si una orden contiene ítems ubicados en diferentes bodegas físicas, el sistema divide la orden en múltiples despachos (`SHIPMENT`), asignando guías de rastreo independientes y calculando fletes consolidados óptimos.
- **Dropshipping**: Arquitectura preparada para enrutar la orden automáticamente al correo o API del proveedor externo afiliado si el producto está marcado con la bandera `isDropshipped`.

---

## CAPÍTULO 7: Orquestación de Pagos (Payment Orchestration)

- **PCI DSS Compliance (Tokenización)**: CommerceOS nunca almacena el PAN (Primary Account Number - número de tarjeta de crédito) en sus bases de datos. Las tarjetas se tokenizan directamente en el navegador del cliente consumiendo los iframes seguros de Stripe o PayPal. Solo almacenamos los tokens lógicos de cobro y los últimos 4 dígitos.
- **Fallback Automático (Ruteo de Pagos)**: Si una petición de cobro a Stripe falla por error `5xx` de infraestructura o problemas de red, el orquestador intercepta el fallo y desvía la petición a Mercado Pago o PayPal en menos de 2 segundos, completando la compra sin alertar al usuario.

---

## CAPÍTULO 8: Ciclo de Vida de Órdenes (OMS)

El procesamiento de pedidos opera bajo un control estricto de bodega:

- **Preparación (Pick & Pack)**: Los operarios de bodega visualizan los pedidos pendientes y generan las listas de recolección física de productos.
- **Despacho y Tracking**: Una vez empacado, el sistema invoca las APIs de transportadoras asociadas (ej. DHL), genera e imprime la etiqueta de envío física y notifica la guía de rastreo al cliente por correo.

---

## CAPÍTULO 9: Máquinas de Estado Transaccionales

Gobernamos las transiciones de estado mediante matrices lógicas estrictas:

### Máquina de Estados de la Orden (`OrderState`)
- `PENDING_PAYMENT` ──(Pago Aprobado)──> `CONFIRMED`
- `CONFIRMED` ──(Pick & Pack)──> `PREPARING`
- `PREPARING` ──(Manifiesto Generado)──> `SHIPPED`
- `SHIPPED` ──(Confirmación de Carrier)──> `DELIVERED`
- `PENDING_PAYMENT` / `CONFIRMED` ──(Cancelación)──> `CANCELLED`

Cualquier cambio de estado que intente saltarse la secuencia (ej: pasar de `PENDING_PAYMENT` directo a `SHIPPED` sin registrar un pago aprobado) es bloqueado por el repositorio lanzando una excepción de negocio (`BusinessError`).

---

## CAPÍTULO 10: Prevención de Fraude y Scoring Inteligente

- **Velocity Checks**: Monitoreo de cantidad de compras por tarjeta o dirección IP en periodos cortos (ej: denegar transacciones si un mismo dispositivo realiza más de 3 intentos de pago fallidos en 5 minutos).
- **Fraud Score**: Evaluación ponderada de atributos del checkout (ej: discrepancia entre país de emisión de tarjeta y país de entrega física del pedido asigna un puntaje de riesgo de fraude). Si el score excede el umbral de 80, la orden pasa a estado `MANUAL_REVIEW` bloqueando el despacho físico hasta la validación de soporte humano.

---

## CAPÍTULO 11: Catálogo de Eventos del Framework Transaccional

Definimos los eventos emitidos por este módulo al bus de EventBridge:

### 1. **`CHECKOUT.COMPLETED`**
- *Publisher*: `Checkout Engine`
- *Consumidores*: `Order Engine (OMS)`, `Inventory Release Worker`, `Analytics Engine` (Prioridad: Alta)
- *Payload*: `{ "checkoutId": "chk_888", "userId": "usr_777", "paymentMethod": "CreditCard", "totalAmount": 150.00 }`

### 2. **`PAYMENT.SUCCEEDED`**
- *Publisher*: `Payment Orchestrator`
- *Consumidores*: `Order Engine (OMS)`, `Billing / Invoice Service` (Prioridad: Alta)

### 3. **`SHIPMENT.DELIVERED`**
- *Publisher*: `Shipping Carrier Sync Service`
- *Consumidores*: `Notification Hub`, `Loyalty Points Engine` (Prioridad: Media)

---

## CAPÍTULO 12: Analytics Transaccionales

Registramos métricas de rendimiento comercial directo:

- **Tasa de Conversión de Checkout**: Relación de checkouts completados versus checkouts iniciados.
- **Latencia de Cobro Financiero**: Tiempo transcurrido entre la petición de confirmación de pago del cliente y la respuesta del procesador bancario.

---

## CAPÍTULO 13: Conexión con Integraciones Externas

Las llamadas a plataformas y pasarelas de terceros se realizan obligatoriamente a través del **Enterprise Integration Framework (ADR-010)**, abstrayendo a CommerceOS de los contratos específicos de:
- **Pasarelas de Pago**: Stripe, PayPal, MercadoPago, Wompi.
- **Operadores Logísticos**: DHL, FedEx, Servientrega.
- **Proveedores de Servicios**: Google Maps API (Geocoding), Facturación Electrónica DIAN/SAT.

---

## CAPÍTULO 14: Inteligencia Artificial en el Checkout (Amazon Bedrock)

- **Predicción de Abandono**: Modelos de IA analizan la velocidad de llenado de formularios de direcciones. Si detectan comportamiento errático o pausas inusuales, alertan al sistema para desplegar un chat de soporte interactivo de ayuda en tiempo real.
- **Recomendación Inteligente de Envíos**: Bedrock evalúa la congestión histórica de las transportadoras por código postal y recomienda de forma predictiva la ruta más rápida y económica para los despachos divididos de bodega.

---

## CAPÍTULO 15: Seguridad y PCI Compliance

- **Aislamiento de Redes**: Todo el flujo de datos que maneja tokens de tarjetas viaja de forma cifrada mediante protocolos seguros HTTPS TLS 1.3.
- **Gobernanza de Operaciones**: Las acciones críticas de cancelación o reembolsos manuales de dinero exigen permisos RBAC validados contra grupos de seguridad corporativos.

---

## CAPÍTULO 16: Observabilidad y Alarmas de Ingesta

- **Alarmas de Fallas de Checkout**: Alarmas críticas se activan de inmediato si la tasa de errores de pago excede el 15% en un intervalo de 10 minutos, alertando ante fallas de conectividad con las APIs de las pasarelas bancarias.

---

## CAPÍTULO 17: Escalabilidad de Pedidos Masivos

- **Queue-buffered Order Creation**: En campañas de ventas masivas (Cyber Monday), el tráfico de confirmaciones de pago no escribe directamente a la base de datos OLTP. Los pagos exitosos se encolan en colas **Amazon SQS** prioritarias asociadas a trabajadores que procesan e insertan las órdenes a un ritmo controlado, evitando cuellos de botella en DynamoDB.

---

## CAPÍTULO 18: Roadmap de Implementación

- **Fase 1: Checkout y OMS Base**: Estructura de sesiones, agregación de órdenes y cobros directos en Stripe.
- **Fase 2: Orquestador de Pagos y Ruteo**: Ruteo dinámico con lógica de fallback automático ante caídas de pasarelas.
- **Fase 3: Logística Avanzada**: Mapeo de transportadoras locales, cálculo de fletes y tracking.
- **Fase 4: Split Shipments y Multi-bodegas**: Reglas de despacho divididas por inventario geolocalizado.
- **Fase 5: Devoluciones y Garantías**: Gestión de solicitudes de retorno de producto y emisión de Store Credits.
- **Fase 6: Predicción de Fraude IA**: Integración de scoring cognitivo y Bedrock para auditorías.

---

## CAPÍTULO 19: Checklist de Aprobación de Compras

Toda transacción de cobro u orden de CommerceOS debe validar estrictamente este checklist antes de entrar a producción:

- [ ] **Tokenización Completa**: Queda prohibido almacenar números de tarjetas o códigos de seguridad en texto plano o cifrado en logs o base de datos.
- [ ] **Gobernanza de Estados**: Toda mutación en órdenes y pagos se realiza a través de transiciones explícitas validadas en la máquina de estados.
- [ ] **Idempotencia de Pagos**: Cada petición de cobro al orquestador incluye una llave de idempotencia única para evitar cobros dobles por reintentos de red.
- [ ] **Propagación Forense**: Los eventos emitidos inyectan los identificadores `traceId` y `correlationId` para asegurar rastreabilidad de transacciones.
