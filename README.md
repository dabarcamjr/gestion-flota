# Gestión Documental de Flota · Transportes Zamora

Aplicación web para controlar los **vencimientos documentales** de la flota (**tractos y ramplas**) y su
**acreditación ante los clientes**, de forma **independiente de Google Sheets**.

🌐 **App:** https://dabarcamjr.github.io/gestion-flota/

## Fase 1 — Equipos
- **Equipos** (tractos y ramplas) con sus documentos.
- Cálculo automático de **vencimiento**, **días restantes** y **estado** (vigente / por vencer / vencido).
- Alta, edición y eliminación de registros.
- **Configuración** de tipos de documento y su vigencia (en meses).
- **Respaldo/exportar** a `.json` (restaurable) y `.csv` (Excel); **importar** respaldo.
- Sembrada con la flota real (103 equipos).

## Fase 2 — Acreditación por cliente
- Pestaña **🏢 Clientes** (SQM, SITRANS, MELÓN, AZA; se pueden agregar/quitar).
- **Matriz de requisitos editable**: qué documentos exige cada cliente por tipo (tracto / rampla).
- Estado de **acreditación** por equipo: acreditado / por vencer / no acreditado, con el detalle documento a documento.
- **Exportar CSV** de acreditación por cliente.

> Nota: el módulo de personas/conductores se retiró; el foco es exclusivamente flota (equipos) y su acreditación.

## Cómo funciona
- 100% en el navegador: los datos se guardan en `localStorage` de este equipo.
- Sin servidores ni dependencias externas. Se publica como sitio estático (GitHub Pages).
- La capa de datos está aislada para poder migrar a una base en la nube más adelante sin rehacer la app.

## Archivos
- `index.html` — estructura de la app.
- `app.js` — lógica (datos, vencimientos, vistas, export/import).
- `seed.js` — datos iniciales (flota real).
- `styles.css` — estilos (tema claro/oscuro).

> ⚠️ Al ser datos en el navegador, **exporta un respaldo con frecuencia**. Borrar los datos del navegador borra la información.
