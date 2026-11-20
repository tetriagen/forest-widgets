// Progress follows the visible semicircle, from its top to its bottom.
function fractionAt(x, y, side) {
    const angle = Math.atan2(y, x);
    const sweep = side === 'right' ? -Math.PI / 2 - angle : angle + Math.PI / 2;
    return Math.max(0, Math.min(1, ((sweep % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / Math.PI));
}
module.exports = {fractionAt};
