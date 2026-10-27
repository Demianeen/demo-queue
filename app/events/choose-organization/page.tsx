import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { WorkspaceLogin } from "@/components/WorkspaceLogin";
import { organizationSelectionCookieName, organizationSelectionFlowId, readOrganizationSelection } from "@/lib/google-auth-flow";

export default async function ChooseOrganizationPage({ searchParams }: { searchParams: Promise<{ flow?: string | string[] }> }) {
  const password = process.env.WORKOS_COOKIE_PASSWORD;
  if (!password) redirect("/events?error=sign-in");
  const { flow } = await searchParams;
  const url = new URL("https://placeholder.invalid");
  if (typeof flow === "string") url.searchParams.set("flow", flow);
  const flowId = organizationSelectionFlowId(url);
  if (!flowId) redirect("/events?error=sign-in");
  const selection = await readOrganizationSelection({ sealed: (await cookies()).get(organizationSelectionCookieName(flowId))?.value, flowId, password });
  if (!selection) redirect("/events?error=sign-in");
  return <WorkspaceLogin organizationSelection={{ organizations: selection.organizations, csrf: selection.csrf, returnTo: selection.returnTo, flowId }} />;
}
