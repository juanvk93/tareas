/* Estado compartido de la interfaz: ajustes cargados, vista actual, grupo activo (G()) y constantes. */
import * as db from './db.js';
import { todoDue, isRepeating, todayKey } from './dates.js';

export const ACCENTS = ['#4f8cff', '#7c5cff', '#ff5c8a', '#ff7a45', '#f5b545', '#35c98b', '#22c3d6', '#8b5cf6', '#ef4444', '#14b8a6'];

export const MEMBER_COLORS = ['#4f8cff', '#ff5c8a', '#35c98b', '#f5b545', '#7c5cff', '#ff7a45', '#22c3d6', '#ef4444'];

export const DEFAULT_GROUP = 'Tareas Hogar';

export const PERSONAL_GROUP = 'Mis tareas'; // Nombre propuesto para el grupo privado.

export const state = {
  view: 'hoy',
  settings: null,
  showDoneToday: false,
  search: '',
  pendingInvite: null, // Invitación recibida por enlace, para rellenar el formulario.
  syncErrors: {}, // groupId → mensaje del último intento de sincronización fallido.
  parseIgnore: new Set() // Lo entendido en el buscador que la persona ha descartado ('date', 'repeat', 'who').
};

/** Configuración del grupo activo (o null si este móvil aún no tiene grupos). */
export const G = () => db.activeGroup(state.settings);

export function hasGroup() { return !!G(); }

/** Fecha que toca ahora a una tarea (ver todoDue / currentDue: agrupa repeticiones perdidas).
 * Con «Las tareas sin hacer pasan a hoy» (group.rollOver), las no repetidas atrasadas son de hoy. */
export function dueOf(t) {
  const due = todoDue(t);
  if (t.done || isRepeating(t.repeat) || !G()?.rollOver) return due;
  const today = todayKey();
  return due < today ? today : due;
}
