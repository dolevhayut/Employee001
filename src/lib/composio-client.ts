// Compatibility shim. Composio is gone; everything resolves to the Microsoft
// Graph implementation in graph-client.ts. Old imports keep working so the
// per-employee API routes, twin runners, and onboarding flow don't have to
// change shape — only the underlying provider does.
//
// The Composio "toolkit" vocabulary is preserved on purpose: the
// /connections UI lists Outlook / Teams / OneDrive / Planner / ToDo /
// SharePoint as separate toolkits even though Microsoft grants one token for
// all of them at once.

export {
  GRAPH_TOOLKITS,
  GRAPH_TOOLKIT_CATALOG,
  type GraphToolkit,
  getEmployeeToolkits,
  composioUserIdFor,
  bucketStatus,
  readState,
  writeState,
  isComposioConfigured,
  isGraphConfigured,
  getComposio,
  initiateConnection,
  refreshConnections,
  disconnectToolkit,
  buildEmployeeMcpServer,
  startGraphDeviceLogin,
  authProviderFor,
  type ConnectionStatus,
  type ConnectionRecord,
  type EmployeeComposioState,
  type DeviceCodeChallenge,
} from "@/lib/graph-client";
