import { NextResponse } from 'next/server';
import { expectedRequestOrigin, PRIVATE_PAGE_HEADERS, SESSION_COOKIE } from '../../../lib/front-office-session.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
    const origin = expectedRequestOrigin(request);
    if (!origin || request.headers.get('origin') !== origin) {
        return new NextResponse('Request rejected.', { status: 403, headers: PRIVATE_PAGE_HEADERS });
    }
    const response = NextResponse.redirect(new URL('/front-office', origin), 303);
    for (const [name, value] of Object.entries(PRIVATE_PAGE_HEADERS)) response.headers.set(name, value);
    response.cookies.set(SESSION_COOKIE, '', {
        httpOnly: true,
        secure: origin.startsWith('https:'),
        sameSite: 'lax',
        path: '/',
        maxAge: 0
    });
    return response;
}
