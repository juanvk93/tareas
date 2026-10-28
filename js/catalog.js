/* Catálogo de tareas habituales, al estilo de los artículos de una lista de
 * la compra: se muestran como casillas y un toque las añade como pendientes.
 * Los iconos son claves de icons.js. */

export const CATALOG = [
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

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export { norm as normalizeTitle };

/** Busca en el catálogo por texto (sin tildes ni mayúsculas). */
export function searchCatalog(q) {
  const n = norm(q);
  if (!n) return [];
  const out = [];
  for (const cat of CATALOG) for (const it of cat.items) if (norm(it.name).includes(n)) out.push(it);
  return out;
}

/** Icono sugerido para un título: el del catálogo si coincide alguna palabra clave. */
export function guessIcon(title) {
  const n = norm(title);
  for (const cat of CATALOG) for (const it of cat.items) if (norm(it.name) === n) return it.icon;
  // La primera palabra suele ser el verbo (limpiar, sacar…): miramos el resto.
  const words = n.split(/\s+/).slice(1).filter((w) => w.length > 3);
  for (const cat of CATALOG) {
    for (const it of cat.items) {
      const iw = norm(it.name).split(/\s+/).filter((w) => w.length > 3);
      if (words.some((w) => iw.includes(w))) return it.icon;
    }
  }
  return 'sparkles';
}
