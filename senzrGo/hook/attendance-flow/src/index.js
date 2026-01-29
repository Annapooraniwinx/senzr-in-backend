export default ({ action }) => {

	action('items.create', async ({ collection, payload }) => {

		// ✅ Trigger ONLY when a record is created in logs collection
		if (collection !== 'logs') return;

		// ✅ Extract fields from the newly created log entry
		const {
			employeeId,
			date,
			timeStamp,
			action,
			mode,
			tenant,
			sn,
		} = payload;

		try {
			await fetch('https://appv1.fieldseasy.com/kn/attendance-flow', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					employeeId,
					date,
					timeStamp,
					action,
					mode,
					tenant,
					sn,
				}),
			});

			console.log('✅ OpenFaaS triggered with log data:', {
				employeeId,
				date,
				timeStamp,
				logAction,
				mode,
				tenant,
				sn,
			});

		} catch (err) {
			console.error('❌ Failed to trigger OpenFaaS:', err);
		}
	});
};
