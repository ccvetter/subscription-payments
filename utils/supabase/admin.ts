import { toDateTime } from '@/utils/helpers';
import { stripe } from '@/utils/stripe/config';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import type { Database, Tables, TablesInsert } from 'types_db';

type Product = Tables<'products'>;
type Price = Tables<'prices'>;

const TRIAL_PERIOD_DAYS = 0;

const supabaseAdmin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const upsertProductRecord = async (product: Stripe.Product) => {
    const productData: Product = {
        id: product.id,
        active: product.active,
        name: product.name,
        description: product.description ?? null,
        image: product.images?.[0] ?? null,
        metadata: product.metadata
    };

    const { error: upsertError } = await supabaseAdmin
        .from('products')
        .upsert([productData]);
    if (upsertError) 
        throw new Error(`Product insert/update failed: ${upsertError.message}`);

    console.log(`Product inserted/updated: ${product.id}`);
}

const upsertPriceRecord = async (
    price: Stripe.Price,
    retryCount = 0,
    maxRetries = 3
) => {
    const priceData: Price = {
        id: price.id,
        product_id: typeof price.product === 'string' ? price.product : '',
        active: price.active,
        currency: price.currency,
        type: price.type,
        unit_amount: price.unit_amount ?? null,
        interval: price.recurring?.interval ?? null,
        interval_count: price.recurring?.interval_count ?? null,
        trial_period_days: price.recurring?.trial_period_days ?? TRIAL_PERIOD_DAYS
    };

    const { error: upsertError } = await supabaseAdmin
        .from('prices')
        .upsert([priceData]);

    if (upsertError?.message.includes('foreign key constraint')) {
        if (retryCount < maxRetries) {
            console.log(`Retry attempt ${retryCount + 1} for price ID: ${price.id}`);
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await upsertPriceRecord(price, retryCount + 1, maxRetries);
        } else {
            throw new Error(
                `Price insert/update failed after ${maxRetries} retries: ${upsertError.message}`
            );
        }
    } else if (upsertError) {
        throw new Error(`Price insert/update failed: ${upsertError.message}`);
    }  else {
        console.log(`Price inserted/updated: ${price.id}`);
    }
};

const deleteProductRecord = async (product: Stripe.Product) => {
    const { error: deletionError } = await supabaseAdmin
        .from('products')
        .delete()
        .eq('id', product.id);

    if (deletionError) 
        throw new Error(`Product deletion failed: ${deletionError.message}`);
    console.log(`Product deleted: ${product.id}`);
};

const upsertCustomerToSupabase = async (uuid: string, customerId: string) => {
    const { error: upsertError } = await supabaseAdmin
        .from('customers')
        .upsert([{ id: uuid, stripe_customer_id: customerId }]);

    if (upsertError)
        throw new Error(`Supabase customer record creation failed: ${upsertError.message}`);

    return customerId;
};

const createOrRetrieveCustomer = async ({
    email,
    uuid
}) => {
    const { data: existingSupabaseCustomer, error: queryError } =
        await supabaseAdmin
            .from('customers')
            .select('*')
            .eq('id', uuid)
            .maybeSingle();

    if (queryError) {
        throw new Error(`Supabase customer lookup failed: ${queryError.message}`);
    }

    // Retrieve the Stripe customer ID using the Supabase customer ID, with email fallback
    let stripeCustomerId: string | undefined;
    if (existingSupabaseCustomer?.stripe_customer_id) {
        const existingStripeCustomer = await stripe.customers.retrieve(
            existingSupabaseCustomer.stripe_customer_id
        );
        stripeCustomerId = existingStripeCustomer.id;
    } else {
        const stripeCustomers = await stripe.customers.list({ email: email });
        stripeCustomerId =
            stripeCustomers.data.length > 0 ? stripeCustomers.data[0].id : undefined;
    }

    const stripeIdToInsert = stripeCustomerId
        ? stripeCustomerId 
        : await createCustomerInStripe(uuid, email);
    if (!stripeIdToInsert) throw new Error('Stripe customer creation failed.');

    if (existingSupabaseCustomer && stripeCustomerId) {
        if (existingSupabaseCustomer.stripe_customer_id !== stripeCustomerId) {
            const { error: updateError } = await supabaseAdmin
                .from('customers')
                .update({ stripe_customer_id: stripeCustomerId })
                .eq('id', uuid);

            if (updateError)
                throw new Error(
                    `Supabase customer record update failed: ${updateError.message}`
                );
            console.warn(
                `Supabase customer record mismatched Stripe ID. Supabase record updated.`
            );
        }

        return stripeCustomerId;
    } else {
        console.warn(
            `Supabase customer record was missing. A new record was created.`
        );

        // If Supabase has no record, create a new record and return Stripe customer ID
        const upsertedStripeCustomer = await upsertCustomerToSupabase(
            uuid,
            stripeIdToInsert
        );
        if (!upsertCustomerToSupabase)
            throw new Error('Supabase customer record creation failed.');

        return upsertCustomerToSupabase;
    }
};

/**
 * Copies the billing details from the payment method to the customer object.
 */
const copyBillingDetailsToCustomer = async (
    uuid: string,
    payment_method: Stripe.PaymentMethod
) => {
    // Todo: check this assertion
    const customer = payment_method.customer as string;
    const { name, phone, address } = payment_method.billing_details;
    if (!name || !phone || !address) return;
    //@ts-ignore
    await stripe.customers.update(customer, { name, phone, address });
    const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({
            billing_address: { ...address },
            payment_method: { ...payment_method[payment_method.type] }
        })
        .eq('id', uuid);
    if (updateError) throw new Error(`Customer update failed: ${updateError.message}`);
}