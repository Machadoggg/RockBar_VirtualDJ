// Genera turnos de prueba para Juanito y Anita del 1 al 20 de julio 2026,
// para poder verificar el calculo de nomina en fechas clave (13 y 20).
// Ejecutar UNA SOLA VEZ desde la raiz del proyecto:
//   node scripts/seed-attendance.js

const staff = require('../lib/staff');
const attendance = require('../lib/attendance');

const YEAR = 2026;
const MONTH = 6; // julio (0-indexado: enero=0 ... julio=6)
const START_DAY = 1;
const END_DAY = 28;

const SCHEDULES = {
  Juanito: {
    entradaHora: 18, // 6:00 p.m.
    salidaEntreSemana: { hora: 0, diasDespues: 1 }, // 12 medianoche
    salidaFinDeSemana: { hora: 2, diasDespues: 1 },  // 2:00 a.m. dia siguiente
  },
  Anita: {
    entradaHora: 20, // 8:00 p.m.
    salidaEntreSemana: { hora: 0, diasDespues: 1 },
    salidaFinDeSemana: { hora: 2, diasDespues: 1 },
  },
};

function isFinDeSemana(dow) {
  return dow === 5 || dow === 6; // viernes(5), sabado(6)
}

async function seedFor(nombre, config) {
  const empleado = staff.getAllStaff().find((s) => s.nombre.toLowerCase() === nombre.toLowerCase());
  if (!empleado) {
    console.log(`⚠️  No se encontro un empleado llamado "${nombre}" — saltando.`);
    return;
  }

  let creados = 0;
  for (let day = START_DAY; day <= END_DAY; day++) {
    const fecha = new Date(YEAR, MONTH, day);
    const dow = fecha.getDay(); // 0=domingo ... 6=sabado
    const finde = isFinDeSemana(dow);

    const entrada = new Date(YEAR, MONTH, day, config.entradaHora, 0, 0);
    const salidaCfg = finde ? config.salidaFinDeSemana : config.salidaEntreSemana;
    const salida = new Date(YEAR, MONTH, day + salidaCfg.diasDespues, salidaCfg.hora, 0, 0);

    const result = await attendance.createManualShift(
      {
        empleadoId: empleado.id,
        entrada: entrada.toISOString(),
        salida: salida.toISOString(),
        notas: 'Turno de prueba (seed) para validar calculo de nomina',
      },
      'seed-script'
    );

    if (result.ok) {
      creados++;
    } else {
      console.log(`   ✗ ${nombre} ${entrada.toLocaleDateString()}: ${result.message}`);
    }
  }
  console.log(`✅ ${nombre}: ${creados} turnos creados.`);
}

async function main() {
  console.log(`Generando turnos de prueba del ${START_DAY} al ${END_DAY} de julio ${YEAR}...`);
  await seedFor('Juanito', SCHEDULES.Juanito);
  await seedFor('Anita', SCHEDULES.Anita);
  console.log('Listo. Revisa el panel de superadmin -> Turnos fichados / Nomina.');
}

main();