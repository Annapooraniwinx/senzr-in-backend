export default ({ action }) => {
  action('items.create', async (meta) => {
    // Only run for tenant collection
    if (meta.collection !== 'tenant') return;

    console.log('Tenant created, waiting 60 seconds before triggering external webhook...');

    // Wait for 60 seconds
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('Resuming after delay, triggering external webhook...');

    try {
      // Replace with your actual URL
      const webhookUrl = "https://appv1.fieldseasy.com/kn/initial-settings";

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(meta),
      });

      if (!response.ok) {
        console.error(`External webhook failed: ${response.status} ${response.statusText}`);
      } else {
        console.log('External webhook triggered successfully');
      }
    } catch (error) {
      console.error('Error triggering external webhook:', error);
    }
  });
};
