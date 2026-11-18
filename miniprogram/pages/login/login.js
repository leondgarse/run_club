// First sign-in on a WeChat account: pick your name + the shared passcode → bound for good (functions/api/wxlogin.js).
import { PEOPLE } from "../../utils/state.js";
import { signIn } from "../../utils/api.js";
import { t } from "../../utils/i18n.js";

Page({
  data: { people: PEOPLE.map((p) => ({ id: p.id, color: p.color })), person: "", passcode: "", busy: false, L: {} },
  onLoad() {
    wx.setNavigationBarTitle({ title: t("Sign in") });
    this.setData({ L: {
      who: t("Who are you?"), passcode: t("Passcode"), unlock: t("Unlock"),
      hint: t("Pick your name and enter the Run Club passcode. You only need to do this once on this WeChat account."),
    } });
  },
  pick(e) { this.setData({ person: e.currentTarget.dataset.p }); },
  onPass(e) { this.setData({ passcode: e.detail.value }); },
  async submit() {
    if (!this.data.person) return wx.showToast({ title: t("Pick your name first"), icon: "none" });
    this.setData({ busy: true });
    wx.showLoading({ title: t("Signing in…") });
    try {
      await signIn({ person: this.data.person, passcode: this.data.passcode.trim() });
      wx.hideLoading();
      wx.reLaunch({ url: `/pages/index/index?tab=${this.data.person}` });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: t("Sign-in failed: {e}", { e: e.message }), icon: "none", duration: 3000 });
      this.setData({ busy: false });
    }
  },
});
