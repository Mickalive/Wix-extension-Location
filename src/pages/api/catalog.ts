import type { APIRoute } from 'astro';
import { services } from '@wix/bookings';
import { auth } from '@wix/essentials';

const elevatedQueryServices = auth.elevate((services as any).queryServices);
const elevatedQueryLocations = auth.elevate((services as any).queryLocations);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stringId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function serviceRow(row: any) {
  const id = stringId(row?._id) ?? stringId(row?.id);
  if (!id) return null;
  return {
    id,
    label: stringId(row?.name) ?? id,
    type: stringId(row?.type),
  };
}

function locationRow(row: any) {
  const id =
    stringId(row?.business?.id) ??
    stringId(row?.business?._id) ??
    stringId(row?.id) ??
    stringId(row?._id);
  if (!id) return null;
  const label =
    stringId(row?.business?.name) ??
    stringId(row?.business?.address?.formattedAddress) ??
    stringId(row?.calculatedAddress?.formattedAddress) ??
    id;
  return { id, label, type: 'BUSINESS' };
}

export const GET: APIRoute = async () => {
  try {
    const [servicesResponse, locationsResponse]: any[] = await Promise.all([
      (elevatedQueryServices as any)({
        query: {
          paging: { limit: 100 },
        },
      }),
      (elevatedQueryLocations as any)({}),
    ]);

    // Wix SDK query methods have used both `items` and resource-named arrays
    // across generated versions. Accept both response shapes while keeping the
    // endpoint DTO stable for the dashboard.
    const rawServices = Array.isArray(servicesResponse?.items)
      ? servicesResponse.items
      : Array.isArray(servicesResponse?.services)
        ? servicesResponse.services
        : [];
    const rawLocations = Array.isArray(locationsResponse?.businessLocations?.locations)
      ? locationsResponse.businessLocations.locations
      : [];

    const catalog = {
      services: rawServices
        .map(serviceRow)
        .filter(Boolean)
        .sort((a: any, b: any) => a.label.localeCompare(b.label)),
      locations: rawLocations
        .map(locationRow)
        .filter(Boolean)
        .sort((a: any, b: any) => a.label.localeCompare(b.label)),
    };

    return json({ catalog });
  } catch (error) {
    console.error('GET /api/catalog failed', error);
    return json({ error: 'CATALOG_READ_FAILED' }, 500);
  }
};