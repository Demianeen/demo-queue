"use node";

import { ConvexError, v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { google, type sheets_v4 } from "googleapis";
import { randomUUID } from "node:crypto";
import {
  FORMULA_COLUMN_RANGES,
  FINALIST_COUNT,
  JUDGING_CATEGORY_COUNT,
  JUDGING_DATA_START_ROW,
  JUDGING_HEADER_ROW,
  JUDGING_HEADERS,
  JUDGING_SHEET_NAME,
  MAXIMUM_SCORE,
  ROUND_ONE_SCORE_COLUMN_INDICES,
  ROUND_ONE_MINIMUM_JUDGES,
  buildJudgingFormulaColumns,
  buildSyncedBasicFilter,
  buildJudgingSheetValues,
  buildJudgingSubmissionRow,
  type JudgingSheetSubmission,
} from "../lib/judging-sheet";

const GOOGLE_SHEETS_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const GOOGLE_DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new ConvexError(`${name} is not configured for this Convex deployment.`);
  return value;
}

function googleAuth() {
  const clientId = requiredEnvironment("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = requiredEnvironment("GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = requiredEnvironment("GOOGLE_OAUTH_REFRESH_TOKEN");
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

function googleApiStatus(error: unknown) {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { code?: unknown; response?: { status?: unknown } };
  if (typeof candidate.code === "number") return candidate.code;
  return typeof candidate.response?.status === "number" ? candidate.response.status : undefined;
}

function googleApiFailure(error: unknown) {
  const status = googleApiStatus(error);
  if (status === 400 || status === 401) {
    return "Google authorization is no longer valid. Run the OAuth setup helper again.";
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

function quoteSheetTitle(title: string) {
  return `'${title.replaceAll("'", "''")}'`;
}

function scoreValidationRequest(sheetId: number, columnIndex: number, endRowIndex: number) {
  return {
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: JUDGING_DATA_START_ROW - 1,
        endRowIndex,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
      },
      rule: {
        condition: {
          type: "NUMBER_BETWEEN",
          values: [
            { userEnteredValue: "0" },
            { userEnteredValue: String(MAXIMUM_SCORE) },
          ],
        },
        inputMessage: `Enter a score from 0 to ${MAXIMUM_SCORE}.`,
        strict: true,
        showCustomUi: true,
      },
    },
  } satisfies sheets_v4.Schema$Request;
}

function columnWidthRequest(
  sheetId: number,
  startColumnIndex: number,
  endColumnIndex: number,
  pixelSize: number,
) {
  return {
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: startColumnIndex,
        endIndex: endColumnIndex,
      },
      properties: { pixelSize },
      fields: "pixelSize",
    },
  } satisfies sheets_v4.Schema$Request;
}

function formattingRequests(sheetId: number, rowCount: number) {
  const endRowIndex = Math.max(rowCount, JUDGING_DATA_START_ROW);
  const requests: sheets_v4.Schema$Request[] = [
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          title: JUDGING_SHEET_NAME,
          gridProperties: {
            frozenRowCount: JUDGING_HEADER_ROW,
            frozenColumnCount: 4,
          },
        },
        fields: "title,gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
        properties: { hiddenByUser: true },
        fields: "hiddenByUser",
      },
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 3,
          startColumnIndex: 0,
          endColumnIndex: 8,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.95, green: 0.96, blue: 0.98 },
            textFormat: { bold: true },
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
      },
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: JUDGING_HEADER_ROW - 1,
          endRowIndex: JUDGING_HEADER_ROW,
          startColumnIndex: 0,
          endColumnIndex: JUDGING_HEADERS.length,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.08, green: 0.12, blue: 0.2 },
            horizontalAlignment: "CENTER",
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
            verticalAlignment: "MIDDLE",
            wrapStrategy: "WRAP",
          },
        },
        fields:
          "userEnteredFormat(backgroundColor,horizontalAlignment,textFormat,verticalAlignment,wrapStrategy)",
      },
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: JUDGING_DATA_START_ROW - 1,
          endRowIndex,
          startColumnIndex: 0,
          endColumnIndex: JUDGING_HEADERS.length,
        },
        cell: {
          userEnteredFormat: {
            verticalAlignment: "TOP",
            wrapStrategy: "WRAP",
          },
        },
        fields: "userEnteredFormat(verticalAlignment,wrapStrategy)",
      },
    },
    {
      setBasicFilter: {
        filter: {
          range: {
            sheetId,
            startRowIndex: JUDGING_HEADER_ROW - 1,
            endRowIndex,
            startColumnIndex: 0,
            endColumnIndex: JUDGING_HEADERS.length,
          },
        },
      },
    },
    columnWidthRequest(sheetId, 1, 3, 190),
    columnWidthRequest(sheetId, 3, 4, 220),
    columnWidthRequest(sheetId, 4, 5, 320),
    columnWidthRequest(sheetId, 5, 7, 150),
    columnWidthRequest(sheetId, 7, 14, 150),
    columnWidthRequest(sheetId, 14, JUDGING_HEADERS.length, 120),
  ];

  for (const columnIndex of ROUND_ONE_SCORE_COLUMN_INDICES) {
    requests.push(scoreValidationRequest(sheetId, columnIndex, endRowIndex));
    requests.push(columnWidthRequest(sheetId, columnIndex, columnIndex + 1, 120));
  }

  for (const range of FORMULA_COLUMN_RANGES) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: JUDGING_DATA_START_ROW - 1,
          endRowIndex,
          ...range,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.92, green: 0.96, blue: 1 },
            textFormat: { bold: true },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });
    requests.push({
      addProtectedRange: {
        protectedRange: {
          range: {
            sheetId,
            startRowIndex: JUDGING_DATA_START_ROW - 1,
            endRowIndex,
            ...range,
          },
          description: "Formula cells",
          warningOnly: true,
        },
      },
    });
  }

  return requests;
}

async function replaceJudgingTab({
  sheets,
  spreadsheetId,
  values,
  replaceDefaultSheet,
}: {
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
  values: (string | number | boolean)[][];
  replaceDefaultSheet: boolean;
}) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });
  const existingSheets = spreadsheet.data.sheets ?? [];
  const managedSheet = existingSheets.find(
    (sheet) => sheet.properties?.title === JUDGING_SHEET_NAME,
  );
  const sheetToReplace =
    managedSheet ?? (replaceDefaultSheet && existingSheets.length === 1 ? existingSheets[0] : undefined);
  const sheetToReplaceId = sheetToReplace?.properties?.sheetId;
  const tempTitle = `Judging setup ${randomUUID()}`;
  let tempSheetId: number | undefined;

  try {
    const addResponse = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: tempTitle,
                gridProperties: {
                  rowCount: Math.max(values.length, JUDGING_DATA_START_ROW),
                  columnCount: JUDGING_HEADERS.length,
                },
              },
            },
          },
        ],
      },
    });
    tempSheetId = addResponse.data.replies?.[0]?.addSheet?.properties?.sheetId ?? undefined;
    if (tempSheetId === undefined) {
      throw new ConvexError("Google did not create the replacement judging tab.");
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoteSheetTitle(tempTitle)}!A1`,
      valueInputOption: "RAW",
      requestBody: { values },
    });

    const formulaColumns = buildJudgingFormulaColumns(
      Math.max(0, values.length - JUDGING_HEADER_ROW),
    );
    if (formulaColumns.length > 0) {
      const finalDataRow = JUDGING_DATA_START_ROW + formulaColumns[0].values.length - 1;
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: formulaColumns.map(({ column, values: formulaValues }) => ({
            range: `${quoteSheetTitle(tempTitle)}!${column}${JUDGING_DATA_START_ROW}:${column}${finalDataRow}`,
            values: formulaValues,
          })),
        },
      });
    }

    const swapRequests: sheets_v4.Schema$Request[] = [];
    if (sheetToReplaceId !== undefined) {
      swapRequests.push({ deleteSheet: { sheetId: sheetToReplaceId } });
    }
    swapRequests.push(...formattingRequests(tempSheetId, values.length));
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: swapRequests },
    });
    tempSheetId = undefined;
  } finally {
    if (tempSheetId !== undefined) {
      await sheets.spreadsheets
        .batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ deleteSheet: { sheetId: tempSheetId } }] },
        })
        .catch(() => undefined);
    }
  }
}

function syncFormattingRequests({
  sheetId,
  currentRowCount,
  endRowIndex,
  basicFilter,
  protectedRanges,
}: {
  sheetId: number;
  currentRowCount: number;
  endRowIndex: number;
  basicFilter: sheets_v4.Schema$BasicFilter | undefined;
  protectedRanges: sheets_v4.Schema$ProtectedRange[];
}) {
  const requests: sheets_v4.Schema$Request[] = [];
  if (currentRowCount < endRowIndex) {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { rowCount: endRowIndex } },
        fields: "gridProperties.rowCount",
      },
    });
  }

  const syncedBasicFilter = buildSyncedBasicFilter(basicFilter, {
    sheetId,
    startRowIndex: JUDGING_HEADER_ROW - 1,
    endRowIndex,
    startColumnIndex: 0,
    endColumnIndex: JUDGING_HEADERS.length,
  });
  if (syncedBasicFilter) {
    requests.push({ setBasicFilter: { filter: syncedBasicFilter } });
  }
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: JUDGING_DATA_START_ROW - 1,
        endRowIndex,
        startColumnIndex: 0,
        endColumnIndex: JUDGING_HEADERS.length,
      },
      cell: {
        userEnteredFormat: {
          verticalAlignment: "TOP",
          wrapStrategy: "WRAP",
        },
      },
      fields: "userEnteredFormat(verticalAlignment,wrapStrategy)",
    },
  });

  for (const columnIndex of ROUND_ONE_SCORE_COLUMN_INDICES) {
    requests.push(scoreValidationRequest(sheetId, columnIndex, endRowIndex));
    requests.push(columnWidthRequest(sheetId, columnIndex, columnIndex + 1, 120));
  }

  for (const range of FORMULA_COLUMN_RANGES) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: JUDGING_DATA_START_ROW - 1,
          endRowIndex,
          ...range,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.92, green: 0.96, blue: 1 },
            textFormat: { bold: true },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });

    const existingProtection = protectedRanges.find(
      (protectedRange) =>
        protectedRange.description === "Formula cells" &&
        protectedRange.range?.startColumnIndex === range.startColumnIndex &&
        protectedRange.range?.endColumnIndex === range.endColumnIndex,
    );
    if (existingProtection?.protectedRangeId !== undefined) {
      requests.push({
        updateProtectedRange: {
          protectedRange: {
            protectedRangeId: existingProtection.protectedRangeId,
            description: "Formula cells",
            warningOnly: true,
            range: {
              sheetId,
              startRowIndex: JUDGING_DATA_START_ROW - 1,
              endRowIndex,
              ...range,
            },
          },
          fields: "range,description,warningOnly",
        },
      });
    } else {
      requests.push({
        addProtectedRange: {
          protectedRange: {
            range: {
              sheetId,
              startRowIndex: JUDGING_DATA_START_ROW - 1,
              endRowIndex,
              ...range,
            },
            description: "Formula cells",
            warningOnly: true,
          },
        },
      });
    }
  }

  return requests;
}

async function syncExistingJudgingSheet({
  sheets,
  spreadsheetId,
  eventName,
  meetUrl,
  submissions,
}: {
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
  eventName: string;
  meetUrl: string;
  submissions: JudgingSheetSubmission[];
}) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields:
      "sheets(properties(sheetId,title,gridProperties(rowCount)),basicFilter,protectedRanges(protectedRangeId,description,range))",
  });
  const managedSheet = spreadsheet.data.sheets?.find(
    (sheet) => sheet.properties?.title === JUDGING_SHEET_NAME,
  );
  const sheetId = managedSheet?.properties?.sheetId;
  if (!managedSheet || typeof sheetId !== "number") {
    throw new ConvexError("The judging sheet no longer has its Judging tab.");
  }

  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetTitle(JUDGING_SHEET_NAME)}!A${JUDGING_HEADER_ROW}:AQ${JUDGING_HEADER_ROW}`,
  });
  const existingHeaders = headerResponse.data.values?.[0] ?? [];
  const legacyLayout = existingHeaders.includes("R1 judge 1") || existingHeaders.includes("R2 judge 1");
  const currentLayout = existingHeaders[0] === "Submission ID" && existingHeaders[14] === "Judge 1";
  if (legacyLayout || !currentLayout) {
    await replaceJudgingTab({
      sheets,
      spreadsheetId,
      values: buildJudgingSheetValues({ eventName, meetUrl, submissions }),
      replaceDefaultSheet: false,
    });
    return;
  }

  const existingIdsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetTitle(JUDGING_SHEET_NAME)}!A${JUDGING_DATA_START_ROW}:A`,
  });
  const existingIdRows = existingIdsResponse.data.values ?? [];
  const rowBySubmissionId = new Map<string, number>();
  existingIdRows.forEach((values, index) => {
    const submissionId = String(values[0] ?? "").trim();
    if (submissionId && !rowBySubmissionId.has(submissionId)) {
      rowBySubmissionId.set(submissionId, JUDGING_DATA_START_ROW + index);
    }
  });

  let nextRow = JUDGING_DATA_START_ROW + existingIdRows.length;
  const sourceUpdates: sheets_v4.Schema$ValueRange[] = [
    {
      range: `${quoteSheetTitle(JUDGING_SHEET_NAME)}!B1`,
      values: [[eventName]],
    },
    {
      range: `${quoteSheetTitle(JUDGING_SHEET_NAME)}!E1`,
      values: [[meetUrl]],
    },
    {
      range: `${quoteSheetTitle(JUDGING_SHEET_NAME)}!G1:H1`,
      values: [["Synced", new Date().toISOString()]],
    },
    {
      range: `${quoteSheetTitle(JUDGING_SHEET_NAME)}!A2:K2`,
      values: [["Judges per submission", ROUND_ONE_MINIMUM_JUDGES, "", "Categories per judge", JUDGING_CATEGORY_COUNT, "", "Stage finalists", FINALIST_COUNT, "", "Score range", `0-${MAXIMUM_SCORE}`]],
    },
    {
      range: `${quoteSheetTitle(JUDGING_SHEET_NAME)}!A3:B3`,
      values: [["Scoring", "Each assigned judge scores Innovation, Execution, and Demo clarity from 0 to 10. Final score appears after both judges complete all three scores."]],
    },
    {
      range: `${quoteSheetTitle(JUDGING_SHEET_NAME)}!A4:AA4`,
      values: [[...JUDGING_HEADERS]],
    },
  ];
  const currentSubmissionIds = new Set(submissions.map((submission) => submission.id));

  for (const submission of submissions) {
    const row = rowBySubmissionId.get(submission.id) ?? nextRow++;
    rowBySubmissionId.set(submission.id, row);
    sourceUpdates.push({
      range: `${quoteSheetTitle(JUDGING_SHEET_NAME)}!A${row}:N${row}`,
      values: [buildJudgingSubmissionRow(submission)],
    });
    sourceUpdates.push({
      range: `${quoteSheetTitle(JUDGING_SHEET_NAME)}!AA${row}`,
      values: [[submission.githubUrl ?? ""]],
    });
    if (submission.roundOneAssignedJudges?.length === 2) {
      sourceUpdates.push(
        {
          range: `${quoteSheetTitle(JUDGING_SHEET_NAME)}!O${row}`,
          values: [[submission.roundOneAssignedJudges[0]]],
        },
        {
          range: `${quoteSheetTitle(JUDGING_SHEET_NAME)}!S${row}`,
          values: [[submission.roundOneAssignedJudges[1]]],
        },
      );
    }
  }
  for (const [submissionId, row] of rowBySubmissionId) {
    if (!currentSubmissionIds.has(submissionId)) {
      sourceUpdates.push({
        range: `${quoteSheetTitle(JUDGING_SHEET_NAME)}!N${row}`,
        values: [["removed"]],
      });
    }
  }

  const finalDataRow = Math.max(
    JUDGING_DATA_START_ROW,
    ...rowBySubmissionId.values(),
  );
  const endRowIndex = finalDataRow;
  const formatting = syncFormattingRequests({
    sheetId,
    currentRowCount: managedSheet.properties?.gridProperties?.rowCount ?? 0,
    endRowIndex,
    basicFilter: managedSheet.basicFilter,
    protectedRanges: managedSheet.protectedRanges ?? [],
  });
  if (formatting.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: formatting },
    });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data: sourceUpdates },
  });

  const formulaColumns = buildJudgingFormulaColumns(
    finalDataRow - JUDGING_DATA_START_ROW + 1,
  );
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: formulaColumns.map(({ column, values }) => ({
        range: `${quoteSheetTitle(JUDGING_SHEET_NAME)}!${column}${JUDGING_DATA_START_ROW}:${column}${finalDataRow}`,
        values,
      })),
    },
  });
}

export const syncJudgingSheet = internalAction({
  args: { eventId: v.id("events"), revision: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const snapshot = await ctx.runQuery(internal.events.getJudgingSheetSyncSnapshot, args);
    if (!snapshot) return;

    try {
      const auth = googleAuth();
      const sheets = google.sheets({ version: "v4", auth });
      await syncExistingJudgingSheet({ sheets, ...snapshot });
      await ctx.runMutation(internal.events.completeJudgingSheetSync, args);
    } catch (error) {
      const message =
        error instanceof ConvexError
          ? String(error.data)
          : googleApiFailure(error);
      await ctx.runMutation(internal.events.completeJudgingSheetSync, {
        ...args,
        error: message,
      });
    }
  },
});

export const createJudgingSheet = action({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args): Promise<{ spreadsheetUrl: string; created: boolean }> => {
    const admin = await ctx.runQuery(api.events.getAdmin, args);
    if (admin.event.eventType !== "hackathon") {
      throw new ConvexError("Judging sheets are only available for hackathon events.");
    }
    if (admin.event.judgingSheetUrl) {
      return { spreadsheetUrl: admin.event.judgingSheetUrl, created: false };
    }

    const folderId = requiredEnvironment("GOOGLE_DRIVE_FOLDER_ID");
    const auth = googleAuth();
    const drive = google.drive({ version: "v3", auth });
    const sheets = google.sheets({ version: "v4", auth });
    const title = `${admin.event.name} judging`;
    let spreadsheetId: string | undefined;
    let createdFileThisRun = false;

    try {
      let folder;
      try {
        folder = await drive.files.get({
          fileId: folderId,
          fields: "mimeType,trashed,capabilities(canAddChildren)",
        });
      } catch (error) {
        if (googleApiStatus(error) === 404) {
          throw new ConvexError(
            "The configured Google Drive folder is not accessible to the connected Google account.",
          );
        }
        throw error;
      }
      if (folder.data.trashed || folder.data.mimeType !== GOOGLE_DRIVE_FOLDER_MIME_TYPE) {
        throw new ConvexError("GOOGLE_DRIVE_FOLDER_ID must point to a Google Drive folder.");
      }
      if (!folder.data.capabilities?.canAddChildren) {
        throw new ConvexError(
          "The connected Google account needs permission to add files to the configured Drive folder.",
        );
      }

      const createdFile = await drive.files.create({
        requestBody: {
          name: title,
          mimeType: GOOGLE_SHEETS_MIME_TYPE,
          parents: [folderId],
        },
        fields: "id",
      });
      spreadsheetId = createdFile.data.id ?? undefined;
      createdFileThisRun = true;
      if (!spreadsheetId) throw new ConvexError("Google did not return a spreadsheet ID.");

      const allSubmissions = [
        ...admin.lineup,
        ...admin.pool,
        ...admin.hidden,
        ...admin.completed,
        ...admin.noShows,
        ...admin.withdrawn,
      ];
      const uniqueSubmissions = [
        ...new Map(allSubmissions.map((submission) => [submission.id, submission])).values(),
      ].sort((a, b) => a.createdAt - b.createdAt) as JudgingSheetSubmission[];
      const values = buildJudgingSheetValues({
        eventName: admin.event.name,
        meetUrl: admin.event.meetUrl,
        submissions: uniqueSubmissions,
      });

      await replaceJudgingTab({
        sheets,
        spreadsheetId,
        values,
        replaceDefaultSheet: createdFileThisRun,
      });

      const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
      const saved = await ctx.runMutation(api.events.saveJudgingSheet, {
        ...args,
        spreadsheetId,
        spreadsheetUrl,
      });
      if (!saved.created && saved.spreadsheetId !== spreadsheetId) {
        await drive.files.update({
          fileId: spreadsheetId,
          requestBody: { trashed: true },
        });
      }
      return { spreadsheetUrl: saved.spreadsheetUrl, created: saved.created };
    } catch (error) {
      if (spreadsheetId && createdFileThisRun) {
        await drive.files
          .update({
            fileId: spreadsheetId,
            requestBody: { trashed: true },
          })
          .catch(() => undefined);
      }
      if (error instanceof ConvexError) throw error;
      throw new ConvexError(`Could not update the judging sheet: ${googleApiFailure(error)}`);
    }
  },
});
