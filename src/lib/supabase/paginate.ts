// PostgREST devuelve como máximo 1000 filas por pedido. Este helper recorre
// todas las páginas de una consulta. La consulta TIENE que venir ordenada
// (`.order()`): sin orden, la paginación saltea filas en silencio.
//
// Uso:
//   const rows = await fetchAllRows((from, to) =>
//     sb.from("tabla").select("col").order("id").range(from, to),
//   );

const PAGE = 1000;

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}
