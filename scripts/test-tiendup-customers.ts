// Tests sin red del chequeo "el correo existe como cliente en Tiendup" (no
// crear clientes nuevos en el alta). Fetch mockeado, nada sale a la red.
//   npx tsx scripts/test-tiendup-customers.ts
import {
  createCustomersCache,
  fetchAllCustomers,
  findCustomerByEmail,
  CUSTOMERS_TTL_FAIL_MS,
  CUSTOMERS_TTL_OK_MS,
  type CustomersListing,
  type TiendupCustomer,
} from "../src/lib/tiendup/customers";
import { decideCustomerGate, decideGrantAction } from "../src/lib/tiendup/customer-gate";
import {
  displayCourseAccessError,
  isNotInTiendupError,
  notInTiendupError,
} from "../src/lib/tiendup/messages";

let fail = 0;
function check(got: unknown, expected: unknown, label: string) {
  const g = JSON.stringify(got);
  const e = JSON.stringify(expected);
  if (g === e) console.log(`  ok  ${label}`);
  else {
    fail++;
    console.error(`FAIL  ${label} -> esperaba ${e}, dio ${g}`);
  }
}

// --- Fetch mockeado ----------------------------------------------------------

type PageBody = Record<string, unknown> | "boom" | number;

/** Mock de fetch: responde por número de página; registra las URLs pedidas. */
function mockFetch(pages: Record<number, PageBody>) {
  const calls: string[] = [];
  const impl = async (url: string): Promise<Response> => {
    calls.push(url);
    const page = Number(new URL(url).searchParams.get("page"));
    const body = pages[page];
    if (body === undefined) return new Response("{}", { status: 404 });
    if (body === "boom") throw new Error("network down");
    if (typeof body === "number") return new Response("err", { status: body });
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { impl, calls };
}

const row = (id: number, email: string) => ({ id, name: `N${id}`, last_name: `A${id}`, email, phone: null });
const BASE = "https://shop.example.test";

async function run() {
  // --- Paginación ---
  {
    const { impl, calls } = mockFetch({
      1: { status: "OK", data: [row(1, "a@x.com"), row(2, "b@x.com")], count: 5, pages: 3, current: 1, next: 2 },
      2: { status: "OK", data: [row(3, "c@x.com"), row(4, "d@x.com")], count: 5, pages: 3, current: 2, next: 3 },
      3: { status: "OK", data: [row(5, "e@x.com")], count: 5, pages: 3, current: 3, next: null },
    });
    const r = await fetchAllCustomers({ apiKey: "k", baseUrl: BASE, fetchImpl: impl });
    check([r.ok, r.complete, r.customers.length], [true, true, 5], "pagina hasta pages y junta todo");
    check(
      calls.map((u) => new URL(u).searchParams.get("page")),
      ["1", "2", "3"],
      "pide las páginas en orden, una por vez",
    );
    check(new URL(calls[0]!).searchParams.get("limit"), "100", "pide limit=100");
    check(new URL(calls[0]!).pathname, "/customers", "solo GET /customers");
  }
  {
    // Tiendup ignora limit=100 y devuelve de a 2: se pagina por `pages`, no por tamaño.
    const { impl } = mockFetch({
      1: { data: [row(1, "a@x.com"), row(2, "b@x.com")], count: "3", pages: "2" },
      2: { data: [row(3, "c@x.com")], count: "3", pages: "2" },
    });
    const r = await fetchAllCustomers({ apiKey: "k", baseUrl: BASE, fetchImpl: impl });
    check([r.complete, r.customers.length], [true, 3], "tolera páginas más chicas y count/pages como string");
  }
  {
    // Sin `pages`: manda `next`.
    const { impl, calls } = mockFetch({
      1: { data: [row(1, "a@x.com")], next: 2 },
      2: { data: [row(2, "b@x.com")], next: null },
    });
    const r = await fetchAllCustomers({ apiKey: "k", baseUrl: BASE, fetchImpl: impl });
    check([r.complete, r.customers.length, calls.length], [true, 2, 2], "sin pages, corta por next vacío");
  }
  {
    // Página del medio falla → incompleto.
    const { impl } = mockFetch({
      1: { data: [row(1, "a@x.com")], pages: 3, count: 3 },
      2: 500,
      3: { data: [row(3, "c@x.com")], pages: 3, count: 3 },
    });
    const r = await fetchAllCustomers({ apiKey: "k", baseUrl: BASE, fetchImpl: impl });
    check([r.ok, r.complete, r.customers.length], [false, false, 1], "HTTP 500 en una página: incompleto");
  }
  {
    const { impl } = mockFetch({ 1: "boom" });
    const r = await fetchAllCustomers({ apiKey: "k", baseUrl: BASE, fetchImpl: impl });
    check([r.ok, r.complete], [false, false], "error de red: incompleto, no lanza");
  }
  {
    const { impl } = mockFetch({ 1: { status: "ERROR", data: [] } });
    const r = await fetchAllCustomers({ apiKey: "k", baseUrl: BASE, fetchImpl: impl });
    check(r.complete, false, "status distinto de OK: incompleto");
  }
  {
    const { impl } = mockFetch({ 1: { status: "OK", data: "nada" } });
    const r = await fetchAllCustomers({ apiKey: "k", baseUrl: BASE, fetchImpl: impl });
    check(r.complete, false, "data no es array: incompleto");
  }
  {
    // Corrimiento: alguien se registra mientras paginamos → se repite una fila
    // y el total no cierra.
    const { impl } = mockFetch({
      1: { data: [row(1, "a@x.com"), row(2, "b@x.com")], count: 4, pages: 2 },
      2: { data: [row(2, "b@x.com"), row(3, "c@x.com")], count: 4, pages: 2 },
    });
    const r = await fetchAllCustomers({ apiKey: "k", baseUrl: BASE, fetchImpl: impl });
    check([r.complete, r.customers.length], [false, 3], "duplicado + total que no cierra: incompleto, sin duplicar");
  }
  {
    const { impl, calls } = mockFetch({});
    const r = await fetchAllCustomers({ apiKey: "", baseUrl: BASE, fetchImpl: impl });
    check([r.ok, r.complete, calls.length], [false, false, 0], "sin key: no llama a nada");
  }
  {
    const { impl } = mockFetch({ 1: { data: [], count: 0, pages: 0 } });
    const r = await fetchAllCustomers({ apiKey: "k", baseUrl: BASE, fetchImpl: impl });
    check([r.complete, r.customers.length], [true, 0], "tienda sin clientes: completo y vacío");
  }

  // --- Normalización ---
  const customers: TiendupCustomer[] = [
    { id: "1", name: "Maria", lastName: "Perez", email: "  Maria.Perez@Gmail.com " },
    { id: "2", name: "Ana", lastName: null, email: null },
  ];
  check(findCustomerByEmail(customers, "maria.perez@gmail.com")?.id, "1", "match con trim + minúsculas");
  check(findCustomerByEmail(customers, " MARIA.PEREZ@GMAIL.COM")?.id, "1", "match con mayúsculas y espacios del lado nuestro");
  check(findCustomerByEmail(customers, "mariaperez@gmail.com"), null, "sin el punto NO matchea (estricto)");
  check(findCustomerByEmail(customers, "_maria.perez@gmail.com"), null, "con basura NO matchea (estricto)");
  check(findCustomerByEmail(customers, ""), null, "correo vacío no matchea con clientes sin correo");

  // --- Cache ---
  {
    let t = 1_000_000;
    const now = () => t;
    const cache = createCustomersCache(now);
    let loads = 0;
    const listing = (complete: boolean): CustomersListing => ({ ok: complete, complete, customers: [], fetchedAt: t });
    let nextComplete = true;
    const loader = async () => {
      loads++;
      return listing(nextComplete);
    };
    await cache.get({ loader });
    await cache.get({ loader });
    check(loads, 1, "segunda lectura sale del cache");
    t += CUSTOMERS_TTL_OK_MS - 1;
    await cache.get({ loader });
    check(loads, 1, "dentro de los 10 min sigue en cache");
    t += 2;
    await cache.get({ loader });
    check(loads, 2, "pasados los 10 min relee");
    t += 5_000;
    await cache.get({ loader, maxAgeMs: 0 });
    check(loads, 3, "maxAgeMs 0 fuerza releer");
    nextComplete = false;
    t += CUSTOMERS_TTL_OK_MS + 1;
    await cache.get({ loader });
    check(loads, 4, "relee al vencer y viene incompleto");
    t += CUSTOMERS_TTL_FAIL_MS + 1;
    await cache.get({ loader });
    check(loads, 5, "incompleto vence al minuto");
    // Lecturas simultáneas comparten el request.
    cache.clear();
    const [a, b] = await Promise.all([cache.get({ loader }), cache.get({ loader })]);
    check([loads, a === b], [6, true], "lecturas simultáneas: un solo request");
  }

  // --- Gate de clientes (auto vs manual) ---
  const shop = { complete: true, customers };
  const shopCut = { complete: false, customers };
  check(
    decideCustomerGate({ mode: "auto", listing: shop, email: "maria.perez@gmail.com" }),
    { action: "enroll" },
    "auto: existe como cliente → inscribe",
  );
  check(
    decideCustomerGate({ mode: "auto", listing: shop, email: "otra@gmail.com" }),
    { action: "block", reason: "not_in_tiendup" },
    "auto: no existe → no inscribe",
  );
  check(
    decideCustomerGate({ mode: "auto", listing: shopCut, email: "maria.perez@gmail.com" }),
    { action: "block", reason: "customer_check_failed" },
    "auto: listado incompleto → no inscribe aunque aparezca (estricto)",
  );
  check(
    decideCustomerGate({ mode: "auto", listing: null, email: "x@gmail.com" }),
    { action: "block", reason: "customer_check_failed" },
    "auto: sin listado → no inscribe",
  );
  // Manual (botones del equipo): nunca pide confirmación ni bloquea.
  check(
    decideCustomerGate({ mode: "manual", listing: shop, email: "otra@gmail.com" }),
    { action: "enroll" },
    "manual: no existe → inscribe directo (Tiendup crea el cliente)",
  );
  check(
    decideCustomerGate({ mode: "manual", listing: shopCut, email: "otra@gmail.com" }),
    { action: "enroll" },
    "manual: no se pudo verificar → inscribe directo",
  );
  check(
    decideCustomerGate({ mode: "manual", listing: null, email: "otra@gmail.com" }),
    { action: "enroll" },
    "manual: sin listado → inscribe directo",
  );
  check(
    decideCustomerGate({ mode: "manual", listing: shop, email: "Maria.Perez@gmail.com" }),
    { action: "enroll" },
    "manual: existe → inscribe",
  );

  // --- Decisión completa (inscriptos + clientes) ---
  const enrolled = [{ name: "Lucia", lastName: "Fernandez", email: "lucifer@hotmail.com" }];
  let customerLoads = 0;
  const load = (l: { complete: boolean; customers: TiendupCustomer[] } | null) => async () => {
    customerLoads++;
    return l;
  };
  customerLoads = 0;
  check(
    await decideGrantAction({ mode: "auto", enrolled, email: "lucifer@hotmail.com", fullName: null, loadCustomers: load(null) }),
    { action: "already_enrolled" },
    "inscripta en el curso → ya tiene acceso",
  );
  check(customerLoads, 0, "inscripta: no lee clientes");
  check(
    (await decideGrantAction({ mode: "auto", enrolled, email: "lu@gmail.com", fullName: "Lucía Fernández", loadCustomers: load(shop) })).action,
    "name_conflict",
    "auto: mismo nombre con otro correo → conflicto",
  );
  check(
    await decideGrantAction({ mode: "auto", enrolled, email: "maria.perez@gmail.com", fullName: "Maria Perez", loadCustomers: load(shop) }),
    { action: "enroll" },
    "auto: no inscripta pero es cliente → inscribe",
  );
  check(
    await decideGrantAction({ mode: "auto", enrolled, email: "nueva@gmail.com", fullName: "Nueva Persona", loadCustomers: load(shop) }),
    { action: "block", reason: "not_in_tiendup" },
    "auto: ni inscripta ni cliente → no inscribe",
  );
  check(
    await decideGrantAction({ mode: "auto", enrolled, email: "nueva@gmail.com", fullName: null, loadCustomers: load(shopCut) }),
    { action: "block", reason: "customer_check_failed" },
    "auto: clientes incompletos → no inscribe",
  );
  // Manual: "manual nunca pide confirmación". Para cualquier combinación de
  // listado de clientes (completo / cortado / caído) y de match contra el
  // curso, la decisión es inscribir o (si ya figura con el correo) marcar.
  // Nunca name_conflict, block ni otra acción, y no lee clientes.
  {
    const listings = [shop, shopCut, { complete: true, customers: [] }, null];
    const casos: { email: string; fullName: string | null; esperado: string }[] = [
      { email: "nueva@gmail.com", fullName: null, esperado: "enroll" },
      { email: "nueva@gmail.com", fullName: "Nueva Persona", esperado: "enroll" },
      { email: "lu@gmail.com", fullName: "Lucía Fernández", esperado: "enroll" }, // mismo nombre, otro correo
      { email: "maria.perez@gmail.com", fullName: "Maria Perez", esperado: "enroll" }, // cliente, no inscripta
      { email: "lucifer@hotmail.com", fullName: "Lucía Fernández", esperado: "already_enrolled" },
    ];
    let malos = 0;
    customerLoads = 0;
    for (const l of listings) {
      for (const c of casos) {
        const d = await decideGrantAction({ mode: "manual", enrolled, ...c, loadCustomers: load(l) });
        if (d.action !== c.esperado) {
          malos++;
          console.error(`  manual ${c.email} / ${c.fullName} / ${l ? (l.complete ? "completo" : "cortado") : "sin listado"} → ${d.action}`);
        }
      }
    }
    check(malos, 0, "manual nunca pide confirmación ni bloquea (20 combinaciones)");
    check(customerLoads, 0, "manual: no lee el listado de clientes");
  }
  check(
    (await decideGrantAction({ mode: "auto", enrolled, email: "lu@gmail.com", fullName: "Lucía Fernández", loadCustomers: load(shop) })).action,
    "name_conflict",
    "auto: el conflicto de nombre sigue frenando",
  );

  // --- Marcador para la ficha ---
  check(notInTiendupError(), "NOT_IN_TIENDUP: El mail no figura en Tiendup", "texto del marcador");
  check(isNotInTiendupError(notInTiendupError()), true, "reconoce el marcador");
  check(isNotInTiendupError("Tiendup 500: NOT_IN_TIENDUP"), false, "solo como prefijo");
  check(displayCourseAccessError(notInTiendupError()), "El mail no figura en Tiendup", "se muestra sin prefijo");
  check(displayCourseAccessError("Tiendup 500: boom"), "Tiendup no respondió (500 boom)", "5xx: legible");
  check(displayCourseAccessError("Tiendup 422: email inválido"), "Tiendup 422: email inválido", "4xx de validación tal cual");
  check(displayCourseAccessError("  "), null, "vacío → null");
}

run().then(() => {
  if (fail) {
    console.error(`\n${fail} fallaron`);
    process.exit(1);
  }
  console.log("\nTodo ok");
});
