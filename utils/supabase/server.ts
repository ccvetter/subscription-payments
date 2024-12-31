import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { Database } from '@/types_db';

// Define a function to create a Supabase client for server-side operations
// The function takes a cookie store created with next/headers cookies as an argument
export const createClient = () => {
    const cookieStore = cookies();

    return createServerClient<Database>(
        // Pass Supabase URL and anon key from the environment to the client
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,

        // Define a cookies object with methods for interacting with the the cookie store and pass it to client
        {
            cookies: {
                get(name: string) {
                    return cookieStore.get(name)?.value;
                },
                set(name: string, value: string, options: CookieOptions) {
                    try {
                        cookieStore.set({ name, value, ...options });
                    } catch (error) {
                        // If the set method is called from a Server Component, an error may occur
                        // This can be ignored if there is middleware refreshing user sessions
                    }
                },
                remove(name: string, options: CookieOptions) {
                    try {
                        cookieStore.set({ name, value: '', ...options });
                    } catch (error) {
                        // Can be ignored because middleware refreshes user sessions
                    }
                }
            }
        }
    );
};
