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
      return new Response(JSON.stringify({ error: 'Payment system not configured. Please contact the club.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Debug: verify key format (first 10 chars only for security)
    const keyPrefix = dojoApiKey.substring(0, 10);
    console.log('DOJO key prefix:', keyPrefix);

    // Create payment intent with DOJO
    // DOJO uses: Authorization: Basic sk_prod_xxx (key directly after Basic, not base64 encoded)
    const response = await fetch('https://api.dojo.tech/payment-intents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${dojoApiKey}`,
        'version': '2024-02-05'
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
        },
        // Required to generate the clientSessionSecret for online payments
        generateRemoteToken: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('DOJO API error:', response.status, errorText);

      // Try to parse as JSON for error message
      let errorMessage = `Payment provider error (${response.status})`;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData?.message || errorData?.error || errorData?.errors?.[0]?.message || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }

      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const responseText = await response.text();
    console.log('DOJO response:', responseText);

    let paymentIntent;
    try {
      paymentIntent = JSON.parse(responseText);
    } catch (e) {
      return new Response(JSON.stringify({ error: `Invalid JSON response: ${responseText.substring(0, 100)}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // DOJO returns id and clientSessionSecret
    // The checkout URL needs the clientSessionSecret as the payment token
    const paymentToken = paymentIntent.clientSessionSecret;

    if (!paymentToken) {
      return new Response(JSON.stringify({ error: `Missing payment token. Response: ${JSON.stringify(paymentIntent).substring(0, 200)}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Return the checkout URL with the payment token
    return new Response(JSON.stringify({
      checkoutUrl: `https://pay.dojo.tech/checkout/${paymentToken}`,
      paymentIntentId: paymentIntent.id
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Payment API error:', error);
    const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Payment service unavailable';
    return new Response(JSON.stringify({ error: message, stack: error instanceof Error ? error.stack : undefined }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
