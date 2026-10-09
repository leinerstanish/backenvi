# ARCHITECTURE DECISION RECORD (ADR-006)
## MEDIA, ASSETS & DIGITAL ASSET MANAGEMENT (DAM) FRAMEWORK

**Estado:** APROBADO  
**Contexto:** Arquitectura e Ingeniería de Gestión de Activos Digitales Enterprise  
**Arquitecto:** Principal Solutions Architect (Especialista en Serverless, S3, CloudFront & DAM)  
**Versión:** 1.0.0  

---

## CAPÍTULO 1: Filosofía del Framework

### ¿Qué es un Digital Asset Management (DAM)?
Un DAM es un sistema centralizado para almacenar, organizar, buscar, enriquecer y distribuir todos los archivos multimedia (imágenes, videos, documentos, modelos 3D) de una corporación. A diferencia de un simple repositorio de archivos, un DAM actúa como una "Única Fuente de Verdad" (Single Source of Truth) capaz de comprender el contenido de los activos, gestionar su ciclo de vida de forma independiente y distribuirlos dinámicamente en múltiples formatos optimizados para cada canal.

### ¿Por qué no guardar simplemente archivos en carpetas de S3 asociándolos a las entidades?
1. **Acoplamiento e Ineficiencia**: Si guardamos la URL de una imagen directamente en un atributo del registro `Product` en DynamoDB, la imagen queda huérfana de metadatos técnicos (resolución, peso original, copyright). Si el CMS o un banner promocional requiere la misma imagen, la descargará y volverá a subir, duplicando espacio y costos.
2. **Ausencia de Control de Versiones**: Modificar una imagen del producto sobrescribiría la fila anterior o crearía enlaces rotos en promociones de campañas pasadas que sigan en caché.
3. **Optimización Manual**: Obliga a los desarrolladores a escribir código de redimensionamiento e inyección de marca de agua en cada módulo síncronamente en lugar de automatizarlo de manera asíncrona.

### Beneficios del Enfoque DAM Desacoplado:
- **Reutilización Global**: Una imagen se sube una sola vez y se asocia mediante llaves relacionales a Productos, Categorías, CMS y Campañas de Marketing.
- **Enriquecimiento Automático**: Extracción asíncrona de metadatos técnicos e inyección automática de etiquetas de IA (Alt Text, OCR, categorías de objetos) sin intervención humana.
- **Transformaciones en Caliente (Edge Computing)**: CloudFront y optimizadores de imagen generan resoluciones específicas al vuelo según el dispositivo del cliente.

### Trade-offs (Compromisos del Diseño):
- **Consistencia Eventual**: La carga de una imagen no la hace disponible instantáneamente para búsquedas inteligentes en OpenSearch; requiere milisegundos de procesamiento asíncrono en el pipeline.
- **Complejidad de Limpieza**: Eliminar un activo requiere verificar primero en tablas relacionales que no esté siendo utilizado en ningún Widget de CMS o banner activo de Email.

---

## CAPÍTULO 2: Arquitectura General del Ingestion Pipeline

El flujo de ingesta, procesamiento, enriquecimiento y entrega de un activo digital sigue la siguiente topología Serverless reactiva:

```
[Usuario / Admin]
       │ 1. Solicita subida segura
       ▼
[API Gateway / Auth]
       │ 2. Retorna URL Firmada (Presigned URL) con TTL largo
       ▼
[Amazon S3: Inbound Bucket] ──(Dispara Evento CDC)──> [DynamoDB Audit Log]
       │
       │ 3. S3 Event ObjectCreated
       ▼
[EventBridge SQS / Processing Queue]
       │
       ▼
[Processing Lambda (Pipeline Orchestrator)]
       │
       ├──> [Virus Scan API] (Bloquea si hay amenaza)
       ├──> [Rekognition / AWS Bedrock] (NSFW, Auto-Tag, Alt-Text)
       ├──> [Elemental MediaConvert] (Transcoding de Video Adaptive HLS)
       └──> [Sharp Image Processing Worker] (AVIF/WebP, Crop, Blur Placeholder)
       │
       ▼
[Amazon S3: Production Bucket]
       │
       ▼
[Amazon CloudFront CDN]
       │
       ▼
[Consumidores (BFF / Frontend / CMS)]
```

### Responsabilidades por Capa:
1. **API Gateway / Cognito Authorizer**: Valida el rol del usuario (ej: `CatalogManager` o `SuperAdmin`) y le otorga una URL firmada de S3 (`Presigned URL`) válida por 5 minutos exclusiva para un prefijo específico.
2. **S3 Inbound Bucket**: Bucket de paso cerrado al público. Recibe las cargas crudas (Raw Binary).
3. **SQS Ingestion Queue**: Amortigua picos de carga masiva durante campañas masivas (Black Friday) y reintenta fallos de transformación.
4. **Processing Orchestrator**: Administra la secuencia de validaciones del activo (Antivirus, Moderación, Conversión, Extracción de Metadatos).
5. **EventBridge Custom Bus**: Emite eventos del ciclo de vida del activo para que otros microservicios (ej: Inventario, CMS) reaccionen.
6. **S3 Production Bucket**: Almacena las variantes optimizadas finales cifradas y con políticas de lectura restringidas a CloudFront OAC.
7. **CloudFront (CDN)**: Distribuye los activos globalmente en el borde.

---

## CAPÍTULO 3: Modelo de Dominio de Activos Digitales (DAM)

Diseñamos 11 entidades lógicas altamente acopladas al agregador de persistencia pero independientes en su ciclo de vida:

### 1. MEDIA
- **Objetivo**: Representar la entidad raíz de un activo digital único del sistema.
- **Atributos**: `id`, `filename`, `originalExtension`, `mimeType`, `fileSize`, `hash` (SHA-256 de-duplicación), `status`, `ownerId`.
- **Relaciones**: Posee una carpeta (`MEDIA_FOLDER`), múltiples versiones (`MEDIA_VERSION`) y variantes (`MEDIA_VARIANT`).
- **Estados**: `UPLOADED` -> `VALIDATING` -> `PROCESSED` / `FAILED` -> `PUBLISHED` -> `ARCHIVED` / `DELETED`.

### 2. MEDIA_FOLDER
- **Objetivo**: Proveer una estructura virtual de directorios (no física en S3) para organización administrativa.
- **Atributos**: `id`, `name`, `parentId` (árbol jerárquico), `path` materializado, `createdAt`, `tenantId`.

### 3. MEDIA_COLLECTION
- **Objetivo**: Agrupación lógica de activos para proyectos específicos (ej: "Campaña de Verano 2026").
- **Atributos**: `id`, `name`, `description`, `isActive`.

### 4. MEDIA_VERSION
- **Objetivo**: Controlar el histórico de cambios del activo original.
- **Atributos**: `id`, `mediaId`, `versionNumber`, `s3KeyRaw`, `actorId`, `changeSummary`, `createdAt`.

### 5. MEDIA_VARIANT
- **Objetivo**: Rastrear y referenciar las transformaciones del activo original (ej: resoluciones mobile, formatos comprimidos WebP/AVIF).
- **Atributos**: `id`, `mediaId`, `versionId`, `format` (AVIF, WebP, HLS), `resolution` (1080p, thumbnail), `s3KeyProduction`, `url`.

### 6. MEDIA_TAG
- **Objetivo**: Palabras clave y clasificaciones taxonómicas asignadas al activo (tanto manuales como generadas por Inteligencia Artificial).
- **Atributos**: `id`, `mediaId`, `name`, `confidenceScore` (certeza de IA, ej. 98%), `source` (AI / MANUAL).

### 7. MEDIA_PERMISSION
- **Objetivo**: Implementar políticas granulares de acceso sobre carpetas o activos confidenciales (ej. contratos, logos embargados).
- **Atributos**: `id`, `mediaId` / `folderId`, `actorId` / `role`, `permissionType` (READ, WRITE, DELETE).

### 8. MEDIA_USAGE
- **Objetivo**: Auditoría cruzada e integridad referencial. Registra qué entidades están renderizando el activo en tiempo real.
- **Atributos**: `id`, `mediaId`, `entityType` (Product, CMS_Widget, Campaign), `entityId`, `createdAt`.

### 9. MEDIA_JOB
- **Objetivo**: Rastrear el estado de ejecución asíncrono del pipeline de optimización.
- **Atributos**: `id`, `mediaId`, `jobType` (TRANSCODE_VIDEO, COMPRESS_IMAGE), `status` (PENDING, RUNNING, COMPLETED, FAILED), `errorLogs`.

### 10. MEDIA_AUDIT
- **Objetivo**: Registro inmutable de seguridad.
- **Atributos**: `id`, `mediaId`, `action` (DOWNLOADED, MODIFIED, ARCHIVED), `actorId`, `ip`, `userAgent`, `timestamp`.

### 11. MEDIA_METADATA
- **Objetivo**: Almacenar información exif, perfiles de color e información SEO/Accesibilidad.
- **Atributos**: `id`, `mediaId`, `altText`, `caption`, `title`, `technicalDetails` (JSON de dimensiones, GPS, codec, bitrate).

---

## CAPÍTULO 4: Políticas de Comportamiento por Tipo de Asset

El DAM implementa flujos de procesamiento especializados según la extensión detectada:

- **Imágenes (JPEG, PNG, WEBP, AVIF)**: Validaciones de perfil de color (sRGB), optimizaciones por compresión sin pérdida y generación de formatos de nueva generación.
- **Videos (MP4, MOV, AVI)**: Activación de pipelines de transcodificación adaptativa HLS/DASH y extracciones de GIF de vista previa y metadatos de audio.
- **Audio (MP3, WAV, AAC)**: Extracción de metadatos ID3, análisis de espectrograma y generación de streams de baja tasa para chat o soporte técnico.
- **PDF y Documentos (PDF, DOCX, XLSX)**: Extracción de texto completo para indexación y generación de vistas previas de la primera página como imagen JPEG.
- **SVG (Vectoriales)**: Desinfección estricta (Sanitization) de código XML para eliminar scripts inyectados (ataques XSS vectoriales).
- **Modelos 3D (GLTF, GLB, USDZ)**: Conversiones cruzadas automatizadas para visores AR en dispositivos Apple y Android.
- **ZIP e Ingestas CAD / Adobe Source (ZIP, DWG, PSD, AI)**: Almacenamiento seguro bajo clases de almacenamiento de archivo (Glacier) con extracción del árbol de directorios interno y previsualizaciones renderizadas para control administrativo.

---

## CAPÍTULO 5: Pipeline de Procesamiento de Ingesta

Cada fase del pipeline debe completarse antes de publicar el activo para su consumo:

1. **Upload**: El cliente sube el archivo a S3 Inbound mediante `PutObject` seguro con firma AWS4.
2. **Validation**: Evaluación del tipo MIME físico del archivo (no de la extensión del nombre) y limitación de tamaño máximo por configuración.
3. **Virus Scan**: Análisis de malware asíncrono inmediato (ClamAV / AWS GuardDuty para S3) moviendo amenazas a cuarentena antes de ser procesados.
4. **Moderation**: AWS Rekognition inspecciona contenido NSFW (violencia, pornografía, drogas) marcando alertas para moderación manual.
5. **Optimization & Compression**: Codificación del archivo original a códecs ultraeficientes sin distorsión visible de imagen.
6. **Resize & Crop**: Creación automática de las variantes estándar del sistema (Desktop, Tablet, Mobile, Thumbnail).
7. **Watermarking**: Superposición dinámica del logotipo de CommerceOS en activos con derechos de autor protegidos.
8. **Metadata Injection**: Fusión de datos EXIF originales con las optimizaciones finales del CDN y almacenamiento en DynamoDB.
9. **Versioning**: Incremento de versión del activo y re-mapeo del enlace de distribución de CloudFront.
10. **Publish Event**: Publicación del evento `MEDIA_PROCESSED` en EventBridge para sincronizaciones de base de datos externas.

---

## CAPÍTULO 6: Transformaciones Dinámicas de Imágenes

Diseñamos soporte para experiencias de renderizado inteligentes:

- **WebP & AVIF**: Generación por defecto para reducir el consumo de ancho de banda del usuario final hasta en un 80% comparado con JPEG clásico.
- **Responsive Profiles**: Generación automática de etiquetas HTML `<picture>` con srcset adaptado para múltiples resoluciones.
- **Blur Placeholder**: Generación de una imagen miniaturizada desenfocada (de 16x16px codificada en base64) para carga progresiva fluida (Lazy Loading).
- **Smart Crop & Focus**: Reconocimiento de rostros o el objeto dominante de la fotografía utilizando algoritmos de saliencia visual (Saliency Detection) para que los recortes automáticos a formato cuadrado mantengan el punto central del contenido enfocado.
- **JPEG XL**: Preparado para adopción futura como estándar de conservación fotográfica sin pérdidas.

---

## CAPÍTULO 7: Transcodificación y Streaming de Video

El almacenamiento masivo de videos crudos degrada la experiencia de usuario. Implementamos el flujo adaptativo:

- **Transcoding (AWS Elemental MediaConvert)**: Conversión automática del video crudo a formatos adaptativos.
- **Adaptive Bitrate (ABR)**: Generación de manifiestos HLS (HTTP Live Streaming) y DASH. El reproductor del cliente (Video.js, Plyr) adapta dinámicamente la calidad (1080p, 720p, 480p, 360p) según las fluctuaciones de velocidad de su conexión a internet.
- **Poster Image**: Captura aleatoria o manual de un fotograma clave de alta calidad a resolución completa para la portada del video.
- **Preview GIF**: Extracción automática de un fragmento animado de 3 segundos en baja resolución para vistas previas en listados de productos o CMS.
- **Subtítulos y Transcripción Automática**: Uso de AWS Transcribe para convertir voz a texto y generar archivos SRT/VTT multilingües automáticamente.

---

## CAPÍTULO 8: Catálogo de Metadatos Enriquecidos

El activo digital almacena un catálogo enriquecido estructurado en un JSON privado bajo DynamoDB:

- **Metadatos Técnicos**: Resolución exacta, relación de aspecto, profundidad de bits, espacio de color (RGB, CMYK), peso de bytes, checksum (SHA-256), codecs de codificación e historial del dispositivo de captura (EXIF, cámara, lente, apertura, GPS si existiera).
- **Dominant Colors**: Paleta de color extraída de las 5 tonalidades dominantes (formato Hexadecimal/RGB) de la imagen para optimizaciones estéticas del frontend (ej. fondos adaptativos de carga).
- **AI Tagging & Captions**: Lista de objetos detectados (ej: "Zapatilla", "Deporte", "Aire Libre") con puntaje de confianza e inyección automática de textos alternativos (`altText`) descriptivos para cumplimiento de normativas de accesibilidad web (WCAG 2.1).

---

## CAPÍTULO 9: Relaciones Multi-Entidad del Catálogo Multimedia

Para evitar la duplicación de almacenamiento e inconsistencias, el DAM utiliza una arquitectura desacoplada donde el recurso físico en S3 e ID en la base de datos es único, y su utilización se mapea relacionalmente en DynamoDB:

```
[MEDIA: id = img_999] 
       │
       ├──> [MEDIA_USAGE: Product_123] ──> Galería de Producto
       ├──> [MEDIA_USAGE: Category_456] ─> Banner de Categoría
       ├──> [MEDIA_USAGE: Blog_Post_77] ──> Imagen Destacada del Post
       └──> [MEDIA_USAGE: Email_Campaign_88] > Imagen de cabecera de boletín
```

- **Restricción de Borrado**: Si un operador del panel administrativo intenta eliminar el activo `img_999`, el servicio valida primero la existencia de registros asociados en la tabla `MEDIA_USAGE`. Si posee referencias activas, el borrado es bloqueado indicando explícitamente qué recursos lo están utilizando para evitar enlaces rotos.

---

## CAPÍTULO 10: Estrategia de Versionado de Assets

El framework DAM implementa control de cambios estricto sobre el archivo:

- **Evolución**: Al subir una nueva versión del mismo activo, se crea una fila en `MEDIA_VERSION` indexando el nuevo archivo crudo en S3.
- **Vínculo Fijo**: Las variantes de visualización de CloudFront actualizan su contenido dinámicamente apuntando a la última versión publicada (`status = PUBLISHED`).
- **Historial & Rollback**: El administrador puede acceder al panel del activo, visualizar miniaturas de versiones pasadas y aplicar un "Rollback" inmediato, re-mapeando los punteros de variante hacia la versión seleccionada sin necesidad de re-subir el archivo.
- **Ciclo de Vida**: Los archivos asociados a versiones antiguas huérfanas se marcan con estado `ARCHIVED` y se mueven automáticamente a almacenamiento Glacier frío para reducción de costos operativos.

---

## CAPÍTULO 11: Seguridad y Políticas de Acceso (RBAC / ABAC)

Los activos digitales se dividen bajo dos políticas de visibilidad de infraestructura:

### 1. Acceso Público (Public Assets)
- *Recursos*: Imágenes de productos, banners de landing pages, logos de marca y recursos estáticos.
- *Canalización*: Lectura directa sin firma de CloudFront CDN. Sin embargo, la carga y subida requiere autenticación y rol IAM con permisos `media.public.write`.

### 2. Acceso Privado (Private Assets)
- *Recursos*: Comprobantes de pago de clientes, PDFs de facturas, contratos de proveedores, planos 3D embargados y material de soporte técnico confidencial.
- *Canalización*: CloudFront configurado con **Signed Cookies** o **Signed URLs** de expiración corta de 15 minutos firmados mediante llave privada asimétrica de CloudFront (KMS).
- *Control*: API Gateway evalúa en el Custom Authorizer los permisos del actor (RBAC) y la propiedad del recurso (ABAC) antes de emitir la URL firmada.

---

## CAPÍTULO 12: Integración de Distribución y CDN (CloudFront)

Configuración técnica de entrega global para alta velocidad:

- **CloudFront OAC (Origin Access Control)**: Restringe el acceso de lectura a los buckets de S3 a únicamente peticiones autenticadas provenientes de CloudFront. Ningún usuario puede saltarse la CDN para leer de S3.
- **Cache Policy**: Cabeceras `Cache-Control: public, max-age=31536000, immutable` inyectadas por CloudFront para forzar almacenamiento prolongado en el navegador del cliente.
- **Edge Compression**: Habilitada de forma obligatoria la compresión Gzip y Brotli para transferencia ultra rápida de código vectorial y archivos de texto.
- **Invalidación**: En caso de actualizaciones críticas de un activo con el mismo nombre y ruta, el servicio emite solicitudes de invalidación de CloudFront en los puntos de presencia (PoPs) globales en un plazo menor a 60 segundos.

---

## CAPÍTULO 13: Topología de Almacenamiento y Ciclo de Vida de S3

Diseñamos una arquitectura de persistencia eficiente en costos:

### Prefijos de Bucket S3:
- `inbound/raw/[mimeType]/[year]/[month]/[mediaId]/original` (Carga temporal)
- `production/optimized/[mediaId]/[version]/[variantResolution].[format]` (Entrega final)
- `private/secure/[tenantId]/[year]/[mediaId]/[filename]` (Confidencial)

### Automatización del Ciclo de Vida de S3 (Lifecycle Rules):
1. **Inbound Bucket**: Eliminación automática de cualquier archivo remanente tras 24 horas (prevención de basura acumulada por cargas abortadas).
2. **Production Bucket**:
   - Transición de variantes no utilizadas de versiones antiguas a **S3 Standard-Infrequent Access (IA)** a los 30 días.
   - Transición a **S3 Glacier Flexible Archive** a los 90 días.
   - Eliminación física permanente solo si el registro `status` en DynamoDB es `DELETED` por más de 180 días.
3. **Replicación Cross-Region**: Replicación asíncrona automatizada hacia una segunda región geográfica de AWS (ej: de `us-east-1` a `us-west-2`) para planes de recuperación ante desastres (DRP) con RTO de 15 minutos.

---

## CAPÍTULO 14: Especificación de la Biblioteca Multimedia (Media Library Console)

El portal administrativo de CommerceOS expone un módulo enriquecido para la gestión del material visual:

- **Estructura Virtual**: Panel de exploración por árbol de carpetas virtuales y visualización por cuadrícula o lista de detalles.
- **Búsqueda Semántica**: Cuadro de búsqueda predictiva que consume de OpenSearch Indexer, permitiendo buscar tanto por nombre físico de archivo como por etiquetas semánticas de IA (ej: buscar "calzado deportivo rojo" devuelve imágenes que Rekognition etiquetó con calzado, zapatilla y rojo, sin que el operador haya escrito esos metadatos manualmente).
- **Control Masivo (Bulk Load)**: Soporte de arrastrar y soltar (Drag and Drop) de múltiples archivos simultáneamente con control de subidas concurrentes.
- **Panel de Versiones e Historial de Uso**: Pestaña lateral que expone dónde se está utilizando el activo en la plataforma y permite cambiar versiones o descargar el original.

---

## CAPÍTULO 15: Integración Headless con CMS Editor

El CMS tipo Elementor y los constructores de landings consumen el DAM de la siguiente manera:

- **Selector Multimedia (Media Picker)**: Widget integrado en el panel del editor visual. Cuando el usuario añade un bloque de imagen o carrusel, no sube un archivo local; selecciona una referencia del DAM.
- **Inyección de Componente Adaptativo**: El widget del CMS inyecta en el HTML final la referencia del `mediaId`. Al renderizarse, el BFF (Backend for Frontend) lee las variantes optimizadas del activo e inyecta la etiqueta `<picture>` responsiva con el formato AVIF más liviano soportado por el navegador del visitante.

---

## CAPÍTULO 16: Automatizaciones Inteligentes y Visión por Computadora

La Inteligencia Artificial se acopla asíncronamente al pipeline de procesamiento tras la carga del activo:

- **Detección de Objetos y Auto-Etiquetado**: AWS Rekognition extrae etiquetas de objetos y conceptos y las registra en la base de datos `MEDIA_TAG`.
- **Textract OCR (Optical Character Recognition)**: Extracción automática del texto impreso en imágenes, banners promocionales y PDFs de facturas, haciéndolos buscables semánticamente.
- **NSFW Guard**: Clasificación automática del activo según niveles de seguridad. Contenidos inapropiados se bloquean preventivamente y se emite un reporte inmediato a un canal seguro de administradores.
- **Background Removal**: Herramienta interactiva en el panel administrativo que llama a Bedrock para remover el fondo de imágenes de producto de forma automática, acelerando la homogeneización visual del catálogo comercial.

---

## CAPÍTULO 17: Catálogo de Eventos del Dominio DAM

Definimos los eventos de integración que se publicarán en el EventBus corporativo:

### 1. **`DAM.MEDIA_UPLOADED`**
- *Descripción*: El activo original ha terminado de cargarse en el bucket temporal.
- *Publica*: `DAM Storage Ingestion`
- *Consumen*: `Virus Scan Worker`, `Audit Service` (Prioridad: Alta)
- *Payload*: `{ "mediaId": "img_111", "s3KeyRaw": "inbound/raw/jpeg/2026/img_111" }`

### 2. **`DAM.MEDIA_VALIDATED`**
- *Descripción*: El activo aprobó las validaciones de malware y de tipo de archivo.
- *Publica*: `DAM Security Scan Service`
- *Consumen*: `Optimization Engine` (Prioridad: Alta)

### 3. **`DAM.MEDIA_PROCESSED`**
- *Descripción*: Todas las variantes (WebP, AVIF, HLS, resoluciones adaptativas) se generaron y guardaron en producción.
- *Publica*: `DAM Processing Engine`
- *Consumen*: `AI Analysis Worker`, `Search Indexer` (Prioridad: Media)
- *Payload*: `{ "mediaId": "img_111", "variants": [{ "format": "AVIF", "url": "https://cdn..." }] }`

### 4. **`DAM.MEDIA_PUBLISHED`**
- *Descripción*: El activo está disponible de forma pública o firmada y se considera listo para uso.
- *Publica*: `DAM Catalog Service`
- *Consumen*: `CMS Service`, `Notification Engine` (Prioridad: Media)

---

## CAPÍTULO 18: Observabilidad y Trazabilidad Forense de Assets

- **AWS X-Ray**: Mapea latencias desde que el usuario inicia la carga en el frontend, pasando por los tiempos de procesamiento en SQS y las Lambdas de procesamiento hasta la persistencia final en producción.
- **CloudWatch Metrics**:
  - `MediaProcessingTime`: Tiempo en segundos requerido para transcodificar o redimensionar activos.
  - `MalwareDetectionRate`: Número de archivos infectados bloqueados.
- **Alarmas de Seguridad**:
  - Alarma si la cola `SQS Ingestion Queue` acumula mensajes sin procesar por más de 10 minutos (cuello de botella de procesamiento).
  - Alerta de falla en el Elemental MediaConvert en procesamiento de videos de catálogo comercial.

---

## CAPÍTULO 19: Escalabilidad, Backpressure y Optimización de Costos

### Procesamiento de 100 Millones de Activos:
- **Backpressure (SQS + AWS Lambda Event Source Mapping)**: Limitamos la concurrencia máxima del consumidor Lambda de procesamiento para evitar saturar las capacidades de CPU de procesamiento de imágenes. Si la carga excede los límites, los eventos esperan ordenadamente en la cola SQS de forma asíncrona.
- **Elemental MediaConvert Queue Allocation**: Asignación de colas reservadas (Reserved Queues) para transcodificación de videos prioritarios con garantía de procesamiento en tiempo real.
- **Cost Management**:
  - Evitamos el procesamiento duplicado computando el Hash SHA-256 de cada archivo crudo. Si un usuario sube un archivo idéntico, el DAM cancela el procesamiento físico, apunta el nuevo registro al activo existente y crea una nueva entrada en `MEDIA_USAGE`.

---

## CAPÍTULO 20: Checklist de Calidad DAM para Despliegues

Antes de habilitar nuevos formatos o integraciones del framework DAM en producción, se debe certificar el cumplimiento de este checklist:

- [ ] **Desinfección de Vectores XML**: Todo archivo SVG pasa por una capa de desinfección estricta antes de ser guardado en producción.
- [ ] **Configuración de CloudFront OAC**: El bucket de producción no permite accesos de lectura directos por fuera de la CDN de CloudFront.
- [ ] **Políticas WORM de Auditoría**: La base de datos de auditoría de descargas y uso de assets está configurada con bloqueo de modificación inmutable.
- [ ] **Manejo de Errores e Idempotencia**: El reenviador de streams y procesadores de SQS implementan idempotencia de eventos usando el `eventId` único.
- [ ] **Mapeo de Integridad Referencial**: Todo intento de borrado físico valida y limpia de forma mandatoria la tabla de uso relacional `MEDIA_USAGE` para prevenir enlaces caídos.
