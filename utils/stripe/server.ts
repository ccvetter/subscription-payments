'use server';

import Stripe from 'stripe';
import { stripe } from '@/utils/stripe/config';
import { createClient } from '@/utils/supabase/server';
import { createOrRetrieveCustomer } from '../supabase/admin';
import {
    getURL,
    getErrorRedirect,
    calculateTrialEndUnixTimestamp
} from '@/utils/helpers';
import { Tables } from '@/types_db';

type Price = Tables<'prices'>;

type CheckoutResponse = {
    errorRedirect?: string;
    sessionId?: string;
};

export async function checkoutWithStripe(
    price: Price,
    redirectPath: string = '/account'
): Promise<CheckoutResponse> {
    try {
        // Get the user
        const supabase = createClient();
        const {
            error,
            data: { user }
        } = await supabase.auth.getUser();

        if (error || !user) {
            console.error(error);
            throw new Error('Could not get user session.');
        }

        // Retrieve or create the customer in Stripe
        let customer: string;
        try {
            customer = await createOrRetrieveCustomer({
                uuid: user?.id || '',
                email: user?.email || ''
            });
        } catch (err) {
            console.error(err);
            throw new Error('Unable to access customer record.');
        }

        let params: Stripe.Checkout.SessionCreateParams = {
            allow_promotion_codes: true,
            billing_address_collection: 'required',
            customer,
            customer_update: {
                address: 'auto'
            },
            line_items: [
                {
                    price: price.id,
                    quantity: 1
                }
            ],
            cancel_url: getURL(),
            success_url: getURL(redirectPath)
        };

        console.log(
            'Trial end:',
            calculateTrialEndUnixTimestamp(price.trial_period_days)
        );
        if (price.type === 'recurring') {
            params = {
                ...params,
                mode: 'subscription',
                subscription_data: {
                    trial_end: calculateTrialEndUnixTimestamp(price.trial_period_days)
                }
            };
        } else if (price.type === 'one_time') {
            params = {
                ...params,
                mode: 'payment'
            };
        }

        // Create a checkout session in Stripe
    }
    
}