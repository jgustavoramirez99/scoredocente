# ScoreDocente (EduScore CS)

Plataforma web de gestión/evaluación docente para el I.E.P. Cervantes School (Puente Piedra, Lima). Desarrollada por Gustavo (GRTech Solutions).

## Stack
- Backend: Node.js/Express (`backend/`), Supabase (Postgres) como base de datos.
- Frontend: HTML/CSS/JS vanilla, un solo archivo grande `frontend/index.html` (Chart.js, jsPDF, SheetJS, Bootstrap).
- Hosting: Render (plan gratuito → el backend "duerme" tras inactividad y el primer request puede tardar 30-60s en responder, causando pantallas de carga largas).
- Repo: GitHub, `jgustavoramirez99/scoredocente`.
- Editor: VS Code (Windows), terminal PowerShell.

## Cómo trabajamos (léelo antes de tocar código aquí)
- Gustavo pide cambios rápidos y casuales, casi siempre en español informal. Prefiere que se avance directo sin mucho preámbulo.
- Cuando pide ideas para textos/mensajes, dar varias opciones cortas agrupadas por tono (cálido, con humor, dulce, motivador) y dejar que él elija.
- Flujo de edición típico: editar `frontend/index.html` directamente en su carpeta local (vía bridge a su compu), verificar visualmente con un screenshot (Playwright headless, forzando la función JS relevante, ej. `mostrarBienvenidaLaura()`) antes de avisar que ya quedó.
- **Límite importante de git**: se puede hacer `git add` + `git commit` en su carpeta local (vía shell remota), pero el `git push` SIEMPRE falla desde ahí porque pide credenciales de GitHub que no están disponibles. El flujo correcto es: dejar el commit listo, y avisarle que corra `git push origin main` en su propia terminal de VS Code.
- Si un comando de git falla con "Unable to create .git/HEAD.lock" o similar, es porque la carpeta montada no permite borrar archivos por defecto — pedir permiso de borrado para esa carpeta, borrar el `.lock` y reintentar.
- El deploy en Render se dispara automático al hacer push a `main`.

## Función especial: bienvenida personalizada de Laura
- Laura es auxiliar del colegio (cuenta con email `laurachavez@cervantesschool.edu.pe`) y tiene una tarjeta de bienvenida especial y animada (confeti, corazones, chispas) que solo ve ella al loguearse, definida en `frontend/index.html`.
- El mensaje principal vive en la constante `MENSAJE_BIENVENIDA_LAURA` (buscar `MENSAJE_BIENVENIDA_LAURA =`); hay un comentario arriba que dice "cambia este mensaje cada día para sorprender a Laura".
- Debajo del título hay una notita en letras pequeñas (`.laura-welcome-note`), editable por separado.
- El panel es un círculo real (no rectángulo), con texto reducido para que quepa — ver `.laura-welcome-card` / `.laura-welcome-card-inner` (~línea 836 en adelante).
- Esta bienvenida se actualiza seguido (casi a diario), así que es un pedido recurrente: Gustavo pide ideas de mensaje nuevo, elige uno, a veces pide ajustes de diseño/animación sobre la marcha.
