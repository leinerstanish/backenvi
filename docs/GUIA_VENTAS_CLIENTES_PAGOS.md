# Guía de Integración Frontend: Ventas, Clientes y Pagos (Crédito / Contado)

Esta guía describe todos los endpoints disponibles para el módulo de Punto de Venta (POS),
incluyendo la creación de clientes, registro de ventas al contado y a crédito,
y el control de abonos y cuotas.

Base URL de desarrollo: http://localhost:3000/dev

---

## ÍNDICE
1. Clientes
2. Ventas (Contado y Crédito)
3. Pagos y Abonos
4. Flujo Completo Paso a Paso
5. Catálogo de Estados y Motivos
6. Estructura de Datos Completa

---

## 1. CLIENTES

Los clientes se deben crear antes de registrar ventas a crédito.
Para ventas al contado sin cliente identificado, el campo clientId es opcional.

---

### POST /clients — Crear Cliente

Request Body (JSON):
  {
    "name":       "Juan García",          (requerido)
    "phone":      "3001234567",           (opcional)
    "email":      "juan@email.com",       (opcional)
    "documentId": "12345678",             (opcional, cédula o NIT)
    "address":    "Calle 10 #20-30"       (opcional)
  }

Response 201:
  {
    "clientId":   "client_abc123def456",
    "name":       "Juan García",
    "phone":      "3001234567",
    "email":      "juan@email.com",
    "documentId": "12345678",
    "address":    "Calle 10 #20-30",
    "createdAt":  "2026-09-08T16:00:00.000Z",
    "updatedAt":  "2026-09-08T16:00:00.000Z"
  }

---

### GET /clients — Listar Clientes

Response 200:
  {
    "items": [
      {
        "clientId":   "client_abc123def456",
        "name":       "Juan García",
        "phone":      "3001234567",
        "email":      "juan@email.com",
        "documentId": "12345678",
        "address":    "Calle 10 #20-30",
        "createdAt":  "2026-09-08T16:00:00.000Z"
      }
    ],
    "total": 1
  }

---

### GET /clients/{clientId} — Obtener un Cliente

Response 200:  (misma estructura que un item de la lista)

Response 404:
  { "error": "Cliente no encontrado" }

---

### PUT /clients/{clientId} — Actualizar Cliente

Request Body (JSON): (solo los campos que deseas cambiar)
  {
    "phone":   "3109876543",
    "address": "Carrera 50 #80-20"
  }

Response 200: (el cliente actualizado completo)

---

## 2. VENTAS (CONTADO Y CRÉDITO)

---

### POST /sales — Crear Venta

Este es el endpoint principal. Con una sola llamada:
  - Registra la venta y todos los productos.
  - Descuenta automáticamente el stock del inventario.
  - Registra el pago inicial si se envía.
  - Calcula el saldo pendiente (balanceDue).

Request Body (JSON):
  {
    "clientId":       "client_abc123def456",  (opcional para contado, recomendado para crédito)
    "saleType":       "CREDIT",               (requerido: "CASH" o "CREDIT")
    "paymentMethod":  "CASH",                 (requerido: "CASH", "CARD", "TRANSFER", "NEQUI")
    "initialPayment": 100000,                 (opcional: monto del pago inicial en crédito. Si es contado, se ignora y se registra el total)
    "dueDate":        "2026-10-08T00:00:00Z", (opcional: fecha límite de pago para créditos)
    "tax":            0,                      (opcional: impuestos adicionales)
    "notes":          "Crédito acordado a 30 días",  (opcional)
    "items": [
      {
        "productId":   "prod_xyz789",   (requerido)
        "name":        "Buso One",      (recomendado, para mostrarlo en el historial)
        "quantity":    2,               (requerido)
        "price":       150000,          (requerido: precio unitario de venta)
        "inventoryId": "inv_abc123"     (opcional pero recomendado para descuento exacto de stock)
      }
    ]
  }

NOTA SOBRE inventoryId:
  Si envías "inventoryId" en cada item, el backend descuenta ese registro de inventario exacto.
  Si no lo envías, el backend busca automáticamente el primer registro de inventario del producto.
  Para mayor precisión en bodegas múltiples, siempre envía "inventoryId".
  Puedes obtener el inventoryId con: GET /inventory?productId={productId}

Response 201:
  {
    "sale": {
      "saleId":       "sale_aaabbbccc111",
      "clientId":     "client_abc123def456",
      "saleType":     "CREDIT",
      "status":       "PARTIAL",
      "totalAmount":  300000,
      "balanceDue":   200000,
      "tax":          0,
      "subtotal":     300000,
      "dueDate":      "2026-10-08T00:00:00Z",
      "notes":        "Crédito acordado a 30 días",
      "items": [
        {
          "productId": "prod_xyz789",
          "name":      "Buso One",
          "quantity":  2,
          "price":     150000,
          "subtotal":  300000
        }
      ],
      "createdAt": "2026-09-08T16:10:00.000Z",
      "updatedAt": "2026-09-08T16:10:00.000Z"
    },
    "initialPayment": {
      "paymentId":     "pay_111222333",
      "saleId":        "sale_aaabbbccc111",
      "clientId":      "client_abc123def456",
      "amount":        100000,
      "paymentMethod": "CASH",
      "paymentDate":   "2026-09-08T16:10:00.000Z"
    }
  }

ESTADOS POSIBLES DE LA VENTA (campo "status"):
  - "PAID"      → Pagada completamente (balanceDue = 0)
  - "PARTIAL"   → Tiene abonos pero sigue debiendo (0 < balanceDue < totalAmount)
  - "PENDING"   → No se ha hecho ningún pago (balanceDue = totalAmount)
  - "CANCELLED" → Cancelada

---

### GET /sales — Listar Ventas

Query Params opcionales:
  ?status=PENDING   → Solo ventas pendientes
  ?status=PARTIAL   → Solo con abonos parciales
  ?status=PAID      → Solo pagadas
  ?saleType=CREDIT  → Solo créditos
  ?saleType=CASH    → Solo contado
  ?clientId=client_abc123def456  → Solo ventas de un cliente

Response 200:
  {
    "items": [
      {
        "saleId":      "sale_aaabbbccc111",
        "clientId":    "client_abc123def456",
        "clientName":  "Juan García",        (enriquecido automáticamente)
        "saleType":    "CREDIT",
        "status":      "PARTIAL",
        "totalAmount": 300000,
        "balanceDue":  200000,
        "createdAt":   "2026-09-08T16:10:00.000Z"
        ...
      }
    ],
    "total": 1
  }

---

### GET /sales/{saleId} — Detalle de Venta

Devuelve la venta completa con:
  - Datos del cliente.
  - Lista de productos vendidos.
  - Historial de todos los pagos realizados.
  - Total pagado hasta la fecha.

Response 200:
  {
    "saleId":      "sale_aaabbbccc111",
    "saleType":    "CREDIT",
    "status":      "PARTIAL",
    "totalAmount": 300000,
    "balanceDue":  200000,
    "client": {
      "clientId": "client_abc123def456",
      "name":     "Juan García",
      "phone":    "3001234567"
    },
    "payments": [
      {
        "paymentId":     "pay_111222333",
        "amount":        100000,
        "paymentMethod": "CASH",
        "paymentDate":   "2026-09-08T16:10:00.000Z"
      }
    ],
    "totalPaid": 100000,
    "items": [ ... ]
  }

---

## 3. PAGOS Y ABONOS

Usar cuando el cliente viene a pagar una cuota de una venta a crédito.

---

### POST /payments/{saleId} — Registrar Abono / Cuota

Path Param: el ID de la venta a la que se le aplica el pago.

Request Body (JSON):
  {
    "amount":        50000,               (requerido: monto del pago)
    "paymentMethod": "NEQUI",             (requerido: "CASH", "CARD", "TRANSFER", "NEQUI")
    "notes":         "Cuota #2",          (opcional)
    "paymentDate":   "2026-09-08T00:00:00Z"  (opcional: si fue ayer, envías la fecha. Por defecto es hoy)
  }

Response 201:
  {
    "payment": {
      "paymentId":     "pay_444555666",
      "saleId":        "sale_aaabbbccc111",
      "clientId":      "client_abc123def456",
      "amount":        50000,
      "paymentMethod": "NEQUI",
      "notes":         "Cuota #2",
      "paymentDate":   "2026-09-08T17:00:00.000Z"
    },
    "sale": {
      "saleId":     "sale_aaabbbccc111",
      "status":     "PARTIAL",
      "balanceDue": 150000
    },
    "message": "Pago registrado. Saldo pendiente: $150.000"
  }

  Si el pago salda la deuda completamente:
    "message": "¡Venta saldada completamente!"
    "sale.status" será "PAID"
    "sale.balanceDue" será 0

Errores posibles:
  400: { "error": "Monto de pago inválido" }
  400: { "error": "Esta venta ya está completamente pagada" }
  404: { "error": "Venta no encontrada" }

---

### GET /payments — Listar Pagos

Query Params opcionales:
  ?saleId=sale_aaabbbccc111  → Todos los pagos de una venta
  ?clientId=client_abc123    → Todos los pagos de un cliente

Response 200:
  {
    "items": [
      {
        "paymentId":     "pay_444555666",
        "saleId":        "sale_aaabbbccc111",
        "amount":        50000,
        "paymentMethod": "NEQUI",
        "paymentDate":   "2026-09-08T17:00:00.000Z",
        "sale": { ... },   (enriquecido)
        "client": { ... }  (enriquecido)
      }
    ],
    "total": 1
  }

---

## 4. FLUJO COMPLETO PASO A PASO

=== CASO 1: VENTA AL CONTADO ===

Paso 1: (Opcional) Crear cliente si no existe
  POST /clients  → guarda clientId

Paso 2: Registrar venta al contado
  POST /sales
  {
    "clientId":      "client_xxx",  (opcional)
    "saleType":      "CASH",
    "paymentMethod": "CARD",
    "items": [
      { "productId": "prod_aaa", "name": "Camiseta Roja", "quantity": 1, "price": 80000 }
    ]
  }
  → status: "PAID", balanceDue: 0
  → El stock se descuenta automáticamente
  → Se registra el pago total automáticamente


=== CASO 2: VENTA A CRÉDITO CON ABONO INICIAL ===

Paso 1: Crear el cliente
  POST /clients  →  clientId: "client_abc"

Paso 2: Registrar venta a crédito con abono inicial
  POST /sales
  {
    "clientId":       "client_abc",
    "saleType":       "CREDIT",
    "paymentMethod":  "CASH",
    "initialPayment": 100000,
    "dueDate":        "2026-10-08T00:00:00Z",
    "items": [
      { "productId": "prod_aaa", "name": "Buso One", "quantity": 2, "price": 150000 }
    ]
  }
  → totalAmount: 300000, balanceDue: 200000, status: "PARTIAL"
  → Stock descontado, abono de $100.000 registrado


Paso 3: El cliente viene a pagar 2 semanas después
  POST /payments/sale_aaabbbccc111
  { "amount": 100000, "paymentMethod": "NEQUI", "notes": "Cuota 2" }
  → balanceDue: 100000, status: "PARTIAL"


Paso 4: El cliente paga el saldo
  POST /payments/sale_aaabbbccc111
  { "amount": 100000, "paymentMethod": "CASH" }
  → balanceDue: 0, status: "PAID" ✅


=== CASO 3: CONSULTAR CARTERA (DEUDORES) ===

  GET /sales?status=PENDING  → ventas sin ningún pago
  GET /sales?status=PARTIAL  → ventas con pagos parciales
  GET /sales?saleType=CREDIT → todos los créditos

  Para ver el detalle de deuda de un cliente específico:
  GET /sales?clientId=client_abc&status=PARTIAL


---

## 5. CATÁLOGO DE ESTADOS Y MÉTODOS

=== ESTADOS DE VENTA (saleType) ===
  "CASH"    → Venta al contado (pago total en el momento)
  "CREDIT"  → Venta a crédito (puede recibir múltiples pagos)

=== ESTADOS DE PAGO (status) ===
  "PAID"      → Completamente pagado
  "PARTIAL"   → Pagado parcialmente (tiene saldo pendiente)
  "PENDING"   → Sin ningún pago (solo créditos)
  "CANCELLED" → Cancelado

=== MÉTODOS DE PAGO (paymentMethod) ===
  "CASH"     → Efectivo
  "CARD"     → Tarjeta débito/crédito
  "TRANSFER" → Transferencia bancaria
  "NEQUI"    → Nequi

---

## 6. ESTRUCTURA DE DATOS DE REFERENCIA

=== CLIENTE ===
  clientId   : string  (ej: "client_abc123")
  name       : string  (nombre completo)
  phone      : string  (teléfono de contacto)
  email      : string  (correo electrónico)
  documentId : string  (cédula o NIT)
  address    : string  (dirección)
  createdAt  : ISO string

=== VENTA ===
  saleId       : string  (ej: "sale_abc123")
  clientId     : string  (referencia al cliente)
  saleType     : "CASH" | "CREDIT"
  status       : "PAID" | "PARTIAL" | "PENDING" | "CANCELLED"
  items        : array de productos vendidos
  subtotal     : number  (suma de todos los items sin impuesto)
  tax          : number  (impuesto aplicado)
  totalAmount  : number  (subtotal + tax)
  balanceDue   : number  (cuánto le falta por pagar al cliente)
  dueDate      : ISO string | null  (fecha límite para créditos)
  notes        : string
  createdAt    : ISO string
  updatedAt    : ISO string

=== ITEM DE VENTA ===
  productId  : string
  name       : string  (nombre del producto en el momento de la venta)
  quantity   : number
  price      : number  (precio unitario)
  subtotal   : number  (quantity × price)
  inventoryId: string  (opcional, para tracking de inventario exacto)

=== PAGO ===
  paymentId     : string  (ej: "pay_abc123")
  saleId        : string  (referencia a la venta)
  clientId      : string  (referencia al cliente)
  amount        : number  (monto del pago)
  paymentMethod : "CASH" | "CARD" | "TRANSFER" | "NEQUI"
  notes         : string
  paymentDate   : ISO string  (fecha del pago)
  createdAt     : ISO string

---

FIN DEL DOCUMENTO
Generado: 2026-09-08 | ProStore Backend API v1.0
