import type { SheetGrid } from './sheet-parse.js';

/**
 * Fetches one spreadsheet's grid from the Google Sheets API: values, the
 * strikethrough on each cell and on runs inside it, and the merged ranges.
 *
 * A plain CSV export would be simpler and needs no key, but it drops all
 * formatting — and a strikethrough is how this supplier says "out of stock".
 *
 * The key travels in a header, not the query string, so it never lands in an
 * access log or an error message that prints the URL.
 */
const FIELDS =
  'sheets(properties(sheetId,title),merges,data(startRow,startColumn,rowData(values(formattedValue,effectiveFormat/textFormat/strikethrough,userEnteredFormat/textFormat/strikethrough,textFormatRuns))))';

export class SheetFetchError extends Error {}

export async function fetchSheetGrid(spreadsheetId: string, apiKey: string): Promise<SheetGrid> {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`,
  );
  url.searchParams.set('includeGridData', 'true');
  url.searchParams.set('fields', FIELDS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'X-goog-api-key': apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new SheetFetchError(
      `Google Sheets did not answer: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  if (!response.ok) {
    // Google's error body names the reason; the status alone is ambiguous.
    let reason = '';
    try {
      const body = (await response.json()) as { error?: { message?: string; status?: string } };
      reason = body.error?.status ?? body.error?.message ?? '';
    } catch {
      // Not JSON; the status will do.
    }
    const hint =
      response.status === 403
        ? 'the API key was refused, or the Google Sheets API is not enabled for it'
        : response.status === 404
          ? 'no such spreadsheet, or it is not shared with "anyone with the link"'
          : response.status === 400
            ? 'the request or API key is invalid'
            : 'Google Sheets returned an error';
    throw new SheetFetchError(
      `Google Sheets ${String(response.status)}${reason ? ` (${reason})` : ''}: ${hint}.`,
    );
  }
  return (await response.json()) as SheetGrid;
}
