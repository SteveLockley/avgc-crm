import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await request.json();
    const { amount, reference, description } = body;

    if (!amount || amount < 100) {
      return new Response(JSON.stringify({ error: 'Amount must be at least £1.00' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get DOJO API key from environment
    const dojoApiKey = locals.runtime?.env?.DOJO_API_KEY;

    if (!dojoApiKey) {
      return new Response(JSON.stringify({ error: 'Payment system not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create payment intent with DOJO
    const response = await fetch('https://api.dojo.tech/payment-intents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${dojoApiKey}`,
        'version': '2022-04-07'
      },
      body: JSON.stringify({
        amount: {
          value: amount, // Amount in pence
          currencyCode: 'GBP'
        },
        reference: reference || `AVGC-${Date.now()}`,
        description: description || 'Alnmouth Village Golf Club Payment',
        config: {
          redirectUrl: `${new URL(request.url).origin}/members/payments?status=complete`
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('DOJO API error:', errorData);
      return new Response(JSON.stringify({ error: 'Failed to create payment' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const paymentIntent = await response.json();

    // Return the checkout URL
    return new Response(JSON.stringify({
      checkoutUrl: `https://pay.dojo.tech/checkout/${paymentIntent.id}`,
      paymentIntentId: paymentIntent.id
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Payment API error:', error);
    return new Response(JSON.stringify({ error: 'Payment service unavailable' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
