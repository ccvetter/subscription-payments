import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

export const createClient = (request: NextRequest) => {
    // Create an unmodified response
    let response = NextResponse.next({
        request: {
            headers: request.headers
        }
    });

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) {
                    return request.cookies.get(name)?.value;
                },
                set(name: string, value: string, options: CookieOptions) {
                    // If the cookie is updated, update the cookies for the request and response
                    request.cookies.set({
                        name,
                        value,
                        ...options
                    });
                    response = NextResponse.next({
                        request: {
                            headers: request.headers
                        }
                    });
                    response.cookies.set({
                        name,
                        value,
                        ...options
                    });
                },
                remove(name: string, options: CookieOptions) {
                    request.cookies.set({
                        name,
                        value: '',
                        ...options
                    });
                    response = NextResponse.next({
                        request: {
                            headers: request.headers
                        }
                    });
                    response.cookies.set({
                        name,
                        value: '',
                        ...options
                    });
                }
            }
        }
    );

    return { supabase, response };
};

export const updateSession = async (request: NextRequest) => {
    try {
        const { supabase, response } = createClient(request);

        await supabase.auth.getUser();

        return response;
    } catch (e) {
        return NextResponse.next({
            request: {
                headers: request.headers
            }
        });
    }
};
