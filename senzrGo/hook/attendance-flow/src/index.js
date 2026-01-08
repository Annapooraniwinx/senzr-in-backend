export default ({ action }) => {

	action('items.create', async ({ collection, payload }) => {

		// ✅ Only trigger for logs collection
		if (collection !== 'logs') return;

		try {
			await fetch('https://appv1.fieldseasy.com/function/attendance-flow', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					employeeId: payload.employeeId,
					date: payload.date,
					tenant: payload.tenant,
				}),
			});

			console.log(`✅ OpenFaaS triggered for collection: ${collection}`);

		} catch (err) {
			console.error('❌ Failed to trigger OpenFaaS:', err.message);
		}

	});

};
