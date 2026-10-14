import crypto from "crypto";
import Coupon from "../models/coupon.model.js";
import Order from "../models/order.model.js";
import Product from "../models/product.model.js";
import { razorpay } from "../lib/razorpay.js";

export const createRazorpayOrder = async (req, res) => {
	try {
		const { products, couponCode } = req.body;
		if (!Array.isArray(products) || products.length === 0) {
			return res.status(400).json({ message: "Cart is empty" });
		}

		const normalizedItems = products.map(({ _id, quantity }) => ({
			product: _id,
			quantity: Number(quantity),
		}));
		if (normalizedItems.some((item) => !item.product || !Number.isInteger(item.quantity) || item.quantity < 1)) {
			return res.status(400).json({ message: "Invalid cart items" });
		}

		const catalogProducts = await Product.find({ _id: { $in: normalizedItems.map((item) => item.product) } });
		if (catalogProducts.length !== normalizedItems.length) {
			return res.status(400).json({ message: "One or more products are unavailable" });
		}

		const items = normalizedItems.map((item) => {
			const product = catalogProducts.find((entry) => entry._id.toString() === item.product.toString());
			return { product: product._id, quantity: item.quantity, price: product.price };
		});
		let totalAmount = items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0);
		let coupon = null;
		if (couponCode) {
			coupon = await Coupon.findOne({ code: couponCode, userId: req.user._id, isActive: true });
			if (!coupon || coupon.expirationDate < new Date()) {
				return res.status(400).json({ message: "Coupon is invalid or expired" });
			}
			totalAmount = Math.round(totalAmount * (1 - coupon.discountPercentage / 100));
		}
		if (totalAmount < 1) return res.status(400).json({ message: "Order total must be greater than zero" });

		const currency = process.env.RAZORPAY_CURRENCY || "USD";
		const paymentOrder = await razorpay.orders.create({
			amount: totalAmount,
			currency,
			receipt: `user_${req.user._id}_${Date.now()}`.slice(0, 40),
		});

		await Order.create({
			user: req.user._id,
			products: items,
			totalAmount: totalAmount / 100,
			couponCode: coupon?.code || null,
			razorpayOrderId: paymentOrder.id,
			paymentStatus: "pending",
		});

		return res.status(200).json({
			orderId: paymentOrder.id,
			amount: paymentOrder.amount,
			currency: paymentOrder.currency,
			keyId: process.env.RAZORPAY_KEY_ID,
		});
	} catch (error) {
		console.error("Error creating Razorpay order:", error);
		return res.status(500).json({ message: "Unable to start checkout" });
	}
};

export const verifyRazorpayPayment = async (req, res) => {
	try {
		const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body;
		if (!orderId || !paymentId || !signature) {
			return res.status(400).json({ message: "Missing Razorpay payment details" });
		}

		const order = await Order.findOne({ razorpayOrderId: orderId, user: req.user._id });
		if (!order) return res.status(404).json({ message: "Order not found" });
		if (order.paymentStatus === "paid") return res.status(200).json({ success: true, orderId: order._id });

		const expectedSignature = crypto
			.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
			.update(`${orderId}|${paymentId}`)
			.digest("hex");
		const actual = Buffer.from(signature, "hex");
		const expected = Buffer.from(expectedSignature, "hex");
		if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
			return res.status(400).json({ message: "Payment signature verification failed" });
		}

		const payment = await razorpay.payments.fetch(paymentId);
		if (payment.order_id !== orderId || payment.status !== "captured" || payment.amount !== Math.round(order.totalAmount * 100)) {
			return res.status(400).json({ message: "Payment is not captured for this order" });
		}

		order.paymentStatus = "paid";
		order.razorpayPaymentId = paymentId;
		await order.save();

		if (order.couponCode) {
			await Coupon.findOneAndUpdate(
				{ code: order.couponCode, userId: req.user._id },
				{ isActive: false }
			);
		}
		if (order.totalAmount >= 200) await createNewCoupon(req.user._id);
		return res.status(200).json({ success: true, orderId: order._id });
	} catch (error) {
		console.error("Error verifying Razorpay payment:", error);
		return res.status(500).json({ message: "Unable to verify payment" });
	}
};

async function createNewCoupon(userId) {
	await Coupon.findOneAndDelete({ userId });
	const newCoupon = new Coupon({
		code: "GIFT" + Math.random().toString(36).substring(2, 8).toUpperCase(),
		discountPercentage: 10,
		expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		userId,
	});
	return newCoupon.save();
}
