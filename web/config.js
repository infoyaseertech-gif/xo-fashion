// Public settings only. The anon/publishable key is SAFE to publish: Row Level Security protects the data.
// NEVER put the service_role key or the Paystack secret key here.
window.XO_CONFIG = {
  supabaseUrl: "",        // e.g. https://abcdxyz.supabase.co
  supabaseAnonKey: "",    // Project Settings -> API -> anon / publishable key
  cardPayments: false,    // set true after Paystack is set up (see README)
  whatsapp: "2349093813119"
};
