/* Cálculo de estadísticas a partir del registro de tareas realizadas. */

/** Devuelve el rango [from, to) en ms para el periodo indicado. */
export function periodRange(period, now = Date.now()) {
  const d = new Date(now);
  if (period === 'week') {
    const day = (d.getDay() + 6) % 7; // Lunes = 0
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day, 0, 0, 0, 0);
    const end = new Date(start.getTime());
    end.setDate(end.getDate() + 7);
    return { from: start.getTime(), to: end.getTime() };
  }
  if (period === 'month') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return { from: start.getTime(), to: end.getTime() };
  }
  return { from: 0, to: Infinity }; // 'all'
}

/**
 * Calcula estadísticas por persona y por tarea.
 * @param {Array} logs      registros activos
 * @param {Array} members   personas activas
 * @param {Array} tasks     tareas activas
 * @param {string} period   'week' | 'month' | 'all'
 */
export function computeStats(logs, members, tasks, period = 'week') {
  const { from, to } = periodRange(period);
  const inRange = logs.filter((l) => l.ts >= from && l.ts < to);

  const memberById = new Map(members.map((m) => [m.id, m]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const totalCount = inRange.length;
  const totalPoints = inRange.reduce((s, l) => s + (l.points || 0), 0);

  // Por persona
  const perMemberMap = new Map();
  for (const m of members) perMemberMap.set(m.id, { member: m, count: 0, points: 0 });
  for (const l of inRange) {
    if (!perMemberMap.has(l.memberId)) {
      // persona borrada: la agrupamos como "Sin asignar"
      perMemberMap.set(l.memberId, {
        member: memberById.get(l.memberId) || { id: l.memberId, name: 'Eliminado', color: '#888', emoji: '' },
        count: 0, points: 0
      });
    }
    const e = perMemberMap.get(l.memberId);
    e.count++; e.points += (l.points || 0);
  }
  const perMember = [...perMemberMap.values()]
    .map((e) => ({
      ...e,
      pctCount: totalCount ? Math.round((e.count / totalCount) * 100) : 0,
      pctPoints: totalPoints ? Math.round((e.points / totalPoints) * 100) : 0
    }))
    .sort((a, b) => b.points - a.points || b.count - a.count);

  // Por tarea
  const perTaskMap = new Map();
  for (const l of inRange) {
    const t = taskById.get(l.taskId) || { id: l.taskId, name: 'Tarea eliminada', icon: 'help' };
    if (!perTaskMap.has(l.taskId)) perTaskMap.set(l.taskId, { task: t, count: 0, points: 0 });
    const e = perTaskMap.get(l.taskId);
    e.count++; e.points += (l.points || 0);
  }
  const perTask = [...perTaskMap.values()].sort((a, b) => b.count - a.count);

  return { period, from, to, totalCount, totalPoints, perMember, perTask, activeMembers: members.length };
}

/** Genera el atributo "d" para un gráfico de anillo (donut) SVG. */
export function donutSegments(perMember, key = 'points') {
  const total = perMember.reduce((s, e) => s + (e[key] || 0), 0);
  if (!total) return [];
  const cx = 60, cy = 60, r = 46, sw = 22;
  let acc = 0;
  const segs = [];
  for (const e of perMember) {
    const val = e[key] || 0;
    if (val <= 0) continue;
    const frac = val / total;
    const start = acc * 2 * Math.PI - Math.PI / 2;
    const end = (acc + frac) * 2 * Math.PI - Math.PI / 2;
    acc += frac;
    const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
    const large = frac > 0.5 ? 1 : 0;
    // Casi todo el círculo: forzamos un anillo completo.
    const d = frac >= 0.999
      ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
      : `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
    segs.push({ d, color: e.member.color, sw, member: e.member, pct: Math.round(frac * 100) });
  }
  return segs;
}
