# Mapping aulario ↔ campus (vía outlook)

Cadena: `horarios_aulas.csv` (materia tal como la escribe el docente al
reservar el aula en MRBS) → `outlook.csv` (catálogo de asignaturas +
docente titular) → `cursadas-ingenieria.csv` (nombre que ve el alumno en el
campus virtual). El puente entre los tres es primero el **nombre** de la
materia y, como desempate/refuerzo, el **apellido del profesor**.

Los tres insumos (`horarios_aulas.csv`, `outlook.csv`/`outlook.pdf` y
`cursadas-ingenieria.csv`) están en [`insumos/`](insumos/), que no se sube al
repo (contiene un export de datos de alumnos/docentes real). Para
reproducir el análisis o re-correr `build_mapping.py` hace falta volver a
generarlos/copiarlos ahí. Lo que sí se versiona es el resultado: este
README y los CSV de mapping/sin-match, más [`mapeo_nombres.csv`](mapeo_nombres.csv)
— la tabla limpia `materia_aulario → nombre_campus` que consume el scraper
(`packages/scrapper/src/mapeoCampus.ts`).

## Antes de mapear: `outlook.csv` tenía texto corrompido

Al revisar los candidatos de menor puntaje aparecían nombres de materia
imposibles ("AGELISMTIEÓNNT ODSE PROYECTOS", "PINRTEESLIÓIGNENCIA
ARTIFICIAL"). Investigando la causa: en el PDF original, cuando una fila
ocupa dos líneas, a veces la segunda línea se renderiza a una altura que
pisa la primera línea de la fila siguiente (dos "baselines" a ~2pt de
diferencia comparten la misma banda). `pdfplumber` intercala los caracteres
de ambas líneas por posición horizontal, produciendo esos anagramas.

Se revisaron las 14 páginas del PDF contra su imagen renderizada (que sí
refleja el texto correcto) y se corrigieron ~20 filas de `outlook.csv`:
nombres de asignatura mezclados con la fila vecina, un título que se filtró
entero a la fila de al lado (ej. "SERVICIOS" de "Ingeniería Económica para
Empresas Industriales y de Servicios" apareciendo pegado a "Ingeniería
Sanitaria"), y ~7 códigos con un dígito de nota al pie insertado en medio
(ej. `ANÁLISIS NUMÉRICO PARA INGENIERÍA` código `6336` → `636`). El
`outlook.csv` ya entregado quedó actualizado con estas correcciones.

## Cómo se matchea

1. **Normalización**: minúsculas, sin acentos, sin puntuación, sin
   stopwords (de/la/el/y/en…). Numerales romanos (`i`,`ii`,`iii`…) se pasan
   a dígito para que "algebra 1a" y "ÁLGEBRA I-A" compartan token. Un token
   pegado tipo "1b" (numeral+letra de variante) se separa en `1`+`b`; un
   token pegado tipo "a1" (letra+número, patrón de **comisión**) se
   descarta entero, porque no identifica la materia y confundía "ÁLGEBRA A"
   con "ÁLGEBRA II" cuando la comisión era "a1"/"a2". También se descarta
   "(com. I)"/"(com:II)" — comisión, no nivel de la materia.
2. **aulario → outlook**: se puntúa cada materia de `horarios_aulas.csv`
   contra las 369 asignaturas de `outlook.csv` con una mezcla de solape de
   tokens (con matcheo por prefijo para abreviaturas: "accion." matchea
   "accionamientos") y similitud de string completa. Por debajo de 0.5 de
   score queda sin match.
3. **outlook → campus**: se repite el mismo puntaje contra los nombres de
   `cursadas-ingenieria.csv` (separando por "/" cuando una fila junta dos
   planes, ej. "Instalaciones Eléctricas A (Plan 2024) / Instalaciones
   Eléctricas I (Plan 2003)"). El código entre paréntesis y el apellido del
   docente de outlook suman puntos como refuerzo, pero **no pueden pisar**
   un match de nombre mucho mejor — la primera versión del script tenía
   este bug: "accion.electricos" se iba a "Instalaciones Eléctricas..."
   porque un profesor de apellido Ferreyra aparecía ahí, ignorando que
   "Accionamientos Eléctricos" calzaba 100% por nombre.

## Resultado

- **252** de las 278 materias distintas de `horarios_aulas.csv` quedaron
  mapeadas a una fila de `cursadas-ingenieria.csv`, la mayoría (>200) con
  el nombre calzando 1.0 y/o con el apellido del profesor confirmando.
- **26** materias del aulario sin match → [`aulario_sin_match.csv`](aulario_sin_match.csv).
- **330** cursadas del campus sin match → [`campus_sin_match.csv`](campus_sin_match.csv).
- Archivo principal: [`mapping_aulario_campus.csv`](mapping_aulario_campus.csv),
  con columnas de score y `metodo_match` (`codigo`/`profesor`/`nombre`
  combinados) para que se pueda filtrar por confianza.

## Sobre las listas de "sin match"

**`aulario_sin_match.csv`**: en su mayoría no son materias reales sino
reservas de aula que no son cursadas — "concurso", "concurso (qca)",
"curso foguista", "curso frigorista", "curso(no docente)", "reservada
(Artigas-Sosa)", "reserva (inf.)". El resto son materias/seminarios que
directamente no están en el catálogo de `outlook.csv` (ej. "formulacion y
eval.de proyectos", "administración empresarial en la economia del
conocimiento", "seminarios INCITAA") — probablemente electivas de posgrado
o cursos que no figuran en esa planilla.

**`campus_sin_match.csv`**: la mayoría **no es una falla de matching**
sino materias que directamente no tienen clase en la semana scrapeada
(24-28 ago 2026, ppio de 2do cuatrimestre) — por ser de 1er cuatrimestre,
por no dictarse este año, o por ser aulas virtuales sin cursada presencial
(ej. "100KStrongAmericas...", "Aula virtual de Práctica", varias sin
profesor asignado). Antes de asumir que falta un match ahí, conviene
cruzar por cuatrimestre contra `outlook.csv`.

## Casos para revisar a mano

Quedaron con un match de menor confianza por ambigüedad real en los datos,
no por falta de información:

- **"programacion a/b/c"** → outlook no tiene "PROGRAMACIÓN A/B/C", solo
  I/II/III. Es plausible que A↔I, B↔II, C↔III (mismo patrón que Álgebra),
  pero no hay una confirmación explícita como sí la hay para Álgebra/Inglés
  (alias documentado en `cursadas-ingenieria.csv`), así que no se forzó.
- **"proyecto transversal c3/ci/vi"** → "c" probablemente signifique
  comisión, no nivel; quedaron todos apuntando a "Proyecto Transversal I"
  por empate técnico, revisar contra el plan de estudios real.
- **"ingles profesional b (com.i)"** (3 filas con "com." + número) → deberían
  ir a "Inglés Profesional II / Inglés Profesional B" (así lo dice el alias
  en `cursadas-ingenieria.csv`), pero al no existir "INGLÉS PROFESIONAL B"
  en `outlook.csv` el desempate cayó en "I". Las variantes con "(com II)"
  sin punto sí resolvieron bien a "II" de casualidad.
- **"transmision del ee"** → matcheó a "MEDIOS DE TRANSMISIÓN"; por nombre
  es más probable que sea "Transmisión de la Energía Eléctrica" (código
  3G3), la abreviatura "ee" no se interpreta como sigla.
- **"direccion de ventas industriales"** → no hay match exacto en el campus
  (0.66 de score); podría estar dado de baja o renombrado en el plan nuevo.
- Los 3 renglones de **"diseño...integ.de equip.est...cañerias/recip."**
  quedaron con score bajo (0.28-0.32) pero apuntando todos al mismo
  candidato razonable, "Diseño e Integridad de Equipos Estáticos".
