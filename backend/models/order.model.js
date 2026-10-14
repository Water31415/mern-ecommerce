import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
	{
		user: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		products: [
			{
				product: {
					type: mongoose.Schema.Types.ObjectId,
					ref: "Product",
					required: true,
				},
				quantity: {
					type: Number,
					required: true,
					min: 1,
				},
				price: {
					type: Number,
					required: true,
					min: 0,
				},
			},
		],
		totalAmount: {
			type: Number,
			required: true,
			min: 0,
		},
		couponCode: { type: String, default: null },
		razorpayOrderId: {
			type: String,
			required: true,
			unique: true,
		},
		razorpayPaymentId: {
			type: String,
			unique: true,
			sparse: true,
		},
		paymentStatus: {
			type: String,
			enum: ["pending", "paid"],
			default: "pending",
		},
	},
	{ timestamps: true }
);

const Order = mongoose.model("Order", orderSchema);

export default Order;
