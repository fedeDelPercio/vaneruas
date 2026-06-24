// Tests de recipientMismatches con los casos reales de la DB.
//   npx tsx scripts/test-recipient-match.ts
import { recipientMismatches } from "../src/lib/payments/recipient";

let fail = 0;
function check(name: string | null, taxId: string | null, expected: string[], label: string) {
  const got = recipientMismatches(name, taxId).sort();
  const exp = [...expected].sort();
  const ok = got.length === exp.length && got.every((g, i) => g === exp[i]);
  if (ok) console.log(`  ok  ${label}`);
  else {
    fail++;
    console.error(`FAIL  ${label} -> esperaba [${exp}], dio [${got}]`);
  }
}

// --- Destinatarios LEGÍTIMOS (no deben marcar nada) ---
check("VANESA CINTIA RUAS", "27284222488", [], "nombre+cuit ok (sin guiones)");
check("Vanesa Cintia Ruas", "27-28422248-8", [], "cuit con guiones");
check("Vanesa Cintia Ruas", null, [], "nombre ok, cuit nulo");
check("PAYPAL *VANESA RUAS", null, [], "paypal con asterisco en el nombre");
check("Vanesa Ruas", null, [], "nombre corto sin segundo nombre");
check("NPVANESARUAS", "****42224**", [], "nombre pegado + cuit enmascarado");
check(null, null, [], "todo nulo, no se puede dudar");
check(null, "27-28422248-8", [], "solo cuit, ok");

// --- Destinatarios que NO coinciden (deben marcar) ---
check("Juan Perez", "20111111119", ["nombre", "cuit"], "otra persona y otro cuit");
check("Maria Gomez", null, ["nombre"], "otro nombre, cuit nulo");
check("Vanesa Cintia Ruas", "20111111119", ["cuit"], "nombre ok pero cuit distinto");
check("Estudio Contable SA", "30999999990", ["nombre", "cuit"], "razón social distinta");
check("Vanesa Gomez", null, ["nombre"], "vanesa pero no ruas");

console.log(fail === 0 ? "\nRECIPIENT MATCH OK" : `\n${fail} TEST(S) FALLARON`);
process.exit(fail === 0 ? 0 : 1);
