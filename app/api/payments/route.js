import { NextResponse } from "next/server";

/**
 * Not implemented yet.
 *
 * The logic already exists in controllers/paymentController.js, but it is written against
 * Express (req/res/next) and cannot run inside a Route Handler unchanged.
 * Adapting it is the backend phase; until then this answers explicitly
 * instead of failing as an unhandled 500.
 */
const pending = () =>
  NextResponse.json(
    {
      message:
        "This endpoint is not implemented yet — controllers/paymentController.js still needs to be adapted to a Next.js Route Handler.",
    },
    { status: 501 },
  );

export const GET = pending;
export const POST = pending;
export const PUT = pending;
export const PATCH = pending;
export const DELETE = pending;
