/* Catálogo INICIAL de tareas habituales, al estilo de los artículos de una
 * lista de la compra. Se copia a cada grupo nuevo (db.seedCatalog) y a partir
 * de ahí cada grupo lo personaliza: categorías y tareas propias.
 * Los iconos son claves de icons.js. */

export const DEFAULT_CATALOG = [
  {
    name: 'Limpieza',
    items: [
      { name: 'Fregar los platos', icon: 'dishes' },
      { name: 'Poner el lavavajillas', icon: 'dishes' },
      { name: 'Pasar la aspiradora', icon: 'broom' },
      { name: 'Barrer', icon: 'broom' },
      { name: 'Fregar el suelo', icon: 'bucket' },
      { name: 'Limpiar el baño', icon: 'toilet' },
      { name: 'Limpiar la ducha', icon: 'bath' },
      { name: 'Limpiar la cocina', icon: 'spray' },
      { name: 'Limpiar cristales', icon: 'window' },
      { name: 'Quitar el polvo', icon: 'sparkles' }
    ]
  },
  {
    name: 'Ropa',
    items: [
      { name: 'Poner la lavadora', icon: 'washer' },
      { name: 'Tender la ropa', icon: 'shirt' },
      { name: 'Recoger la ropa', icon: 'basket' },
      { name: 'Planchar', icon: 'iron' },
      { name: 'Cambiar las sábanas', icon: 'bed' },
      { name: 'Hacer la cama', icon: 'bed' }
    ]
  },
  {
    name: 'Cocina y compra',
    items: [
      { name: 'Cocinar', icon: 'cooking' },
      { name: 'Preparar la comida de mañana', icon: 'cooking' },
      { name: 'Hacer la compra', icon: 'cart' },
      { name: 'Limpiar la nevera', icon: 'droplet' }
    ]
  },
  {
    name: 'Basura',
    items: [
      { name: 'Sacar la basura', icon: 'trash' },
      { name: 'Sacar el reciclaje', icon: 'trash' },
      { name: 'Sacar el vidrio', icon: 'trash' }
    ]
  },
  {
    name: 'Mascotas y plantas',
    items: [
      { name: 'Pasear al perro', icon: 'paw' },
      { name: 'Dar de comer a la mascota', icon: 'paw' },
      { name: 'Limpiar el arenero', icon: 'paw' },
      { name: 'Regar las plantas', icon: 'plant' }
    ]
  },
  {
    name: 'Otros',
    items: [
      { name: 'Recoger un paquete', icon: 'box' },
      { name: 'Llevar el coche al taller', icon: 'car' },
      { name: 'Tomar la medicación', icon: 'pill' },
      { name: 'Pedir cita', icon: 'calendar' }
    ]
  }
];

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export { norm as normalizeTitle };

/** Busca por texto (sin tildes ni mayúsculas) en una lista de tareas habituales. */
export function searchItems(list, q) {
  const n = norm(q);
  if (!n) return [];
  return list.filter((it) => norm(it.name).includes(n));
}

/** Icono sugerido para un título: el de la tarea habitual que coincida o
 * que comparta alguna palabra (sin contar la primera, que suele ser el verbo). */
export function guessIcon(title, list = DEFAULT_CATALOG.flatMap((c) => c.items)) {
  const n = norm(title);
  const exact = list.find((it) => norm(it.name) === n);
  if (exact) return exact.icon;
  const words = n.split(/\s+/).slice(1).filter((w) => w.length > 3);
  for (const it of list) {
    const iw = norm(it.name).split(/\s+/).filter((w) => w.length > 3);
    if (words.some((w) => iw.includes(w))) return it.icon;
  }
  return 'sparkles';
}
