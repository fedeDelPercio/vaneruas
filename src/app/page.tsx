import { redirect } from "next/navigation";

// Entry point: el dashboard vive bajo /conversations. El gate de perfil se
// resuelve en el layout del grupo (dashboard).
export default function Home() {
  redirect("/conversations");
}
