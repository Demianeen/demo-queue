type GoogleApiErrorShape = {
  code?: unknown;
  response?: {
    status?: unknown;
    data?: {
      error?:
        | string
        | {
            status?: unknown;
            errors?: Array<{ reason?: unknown }>;
          };
    };
  };
};

export function googleApiStatus(error: unknown) {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as GoogleApiErrorShape;
  if (typeof candidate.code === "number") return candidate.code;
  return typeof candidate.response?.status === "number" ? candidate.response.status : undefined;
}

export function googleApiReason(error: unknown) {
  if (typeof error !== "object" || error === null) return undefined;
  const apiError = (error as GoogleApiErrorShape).response?.data?.error;
  if (typeof apiError === "string") return apiError;
  const nestedReason = apiError?.errors?.find(
    (entry) => typeof entry.reason === "string",
  )?.reason;
  if (typeof nestedReason === "string") return nestedReason;
  return typeof apiError?.status === "string" ? apiError.status : undefined;
}

export function googleApiFailure(error: unknown) {
  const status = googleApiStatus(error);
  const reason = googleApiReason(error);
  if (
    status === 401 ||
    reason === "invalid_grant" ||
    reason === "invalid_client" ||
    reason === "unauthorized_client"
  ) {
    return "Google authorization is no longer valid. Run the OAuth setup helper again.";
  }
  if (status === 400) {
    return reason
      ? `Google rejected the judging sheet update (${reason}).`
      : "Google rejected the judging sheet update because the request was invalid.";
  }
  if (status === 403) {
    return "The connected Google account does not have permission to update the judging sheet.";
  }
  if (status === 404) {
    return "Google could not find the configured Drive file.";
  }
  if (status === 429) {
    return "Google temporarily rate-limited the judging sheet export. Try again shortly.";
  }
  return status ? `Google API request failed with status ${status}.` : "Google API request failed.";
}
