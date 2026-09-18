/**
 * `cubeWord` is what the background cubes spell out, which is not always the
 * heading: it is set in English, gets an exclamation on the last step, and
 * breaks "Model & Design" across three lines so it stacks into one block.
 */
export const phases = [
  {
    number: "01",
    cubeWord: "Tune Up",
    title: "Tune up",
    label: "Impresora / calibrando",
    description:
      "La impresora entra en escena: nivelamos la cama, recorremos los ejes y afinamos el cabezal antes de producir una sola capa.",
  },
  {
    number: "02",
    cubeWord: "Model\n&\nDesign",
    title: "Model & Design",
    label: "Florero / malla activa",
    description:
      "La máquina baja su presencia y el florero toma el foco como una malla editable: silueta, volumen y proporciones se resuelven digitalmente.",
  },
  {
    number: "03",
    cubeWord: "Digitalization",
    title: "Digitalización",
    label: "Archivo / generando",
    description:
      "El modelo se separa en trayectorias y capas. Esa geometría se traduce en un archivo que la impresora puede leer y ejecutar.",
  },
  {
    number: "04",
    cubeWord: "Printing!",
    title: "Printing",
    label: "Archivo cargado / imprimiendo",
    description:
      "El archivo llega a la impresora, la máquina recupera el protagonismo y el florero aparece físicamente mientras el cabezal deposita cada capa.",
  },
];
