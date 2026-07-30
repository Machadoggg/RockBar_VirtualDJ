/**
 * Calcula la "clave de noche" actual: un identificador de dia (YYYY-MM-DD)
 * que se usa para agrupar los pedidos de una misma "noche de bar".
 *
 * Si nightResetHour = 6, entonces todo lo que pase entre las 00:00 y las 05:59
 * cuenta como parte de la noche del DIA ANTERIOR (asi una noche que cruza
 * la medianoche no reinicia el contador a mitad de la fiesta).
 */
function getNightKey(date = new Date(), nightResetHour = 6) {
  const d = new Date(date.getTime());
  if (d.getHours() < nightResetHour) {
    d.setDate(d.getDate() - 1);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

module.exports = { getNightKey };
