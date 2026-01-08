

import express from "express";
import Razorpay from "razorpay";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

// Initialize Razorpay in TEST mode
const razorpay = new Razorpay({
	key_id: "rzp_test_RkntHiyJm4WaMb",
	key_secret: "rJnYblhES5gguEBHxESk8KpA",
});

// Example route to send bulk payments
app.post("/bulk-payout", async (req, res) => {
	const { employees } = req.body; // array of {name, account_number, ifsc, amount}

	try {
		const payouts = await Promise.all(employees.map(emp => {
			return razorpay.payout.create({
				account_number: emp.account_number,
				fund_account: {
					account_type: "bank_account",
					bank_account: {
						name: emp.name,
						ifsc: emp.ifsc,
						account_number: emp.account_number,
					},
				},
				amount: emp.amount * 100, // in paise
				currency: "INR",
				mode: "IMPS",
				purpose: "salary",
				narration: `Salary for ${emp.name}`,
			});
		}));

		res.json({ success: true, payouts });
	} catch (error) {
		console.error(error);
		res.status(500).json({ success: false, error: error.message });
	}
});

app.listen(3000, () => console.log("Server running on port 3000"));

