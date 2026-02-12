export function debounce<T extends (...args: any[]) => any>(fn: T, ms: number) {
	let timer: ReturnType<typeof setTimeout> | null = null;

	return {
		call(...args: Parameters<T>) {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = null;
				fn(...args);
			}, ms);
		},
		cancel() {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		},
	};
}
