import pytest

from app.services.normalizer import parse_amount, parse_split_amount, to_cents


class TestParseAmount:
    def test_simple_positive(self):
        assert parse_amount("42.99") == 42.99

    def test_simple_negative(self):
        assert parse_amount("-42.99") == -42.99

    def test_parentheses(self):
        assert parse_amount("(42.99)") == -42.99

    def test_dollar_sign(self):
        assert parse_amount("$1,234.56") == 1234.56

    def test_pound_sign(self):
        assert parse_amount("£99.99") == 99.99

    def test_comma_thousands(self):
        assert parse_amount("1,234.56") == 1234.56

    def test_european_format(self):
        assert parse_amount("1.234,56") == 1234.56

    def test_space_thousands(self):
        assert parse_amount("1 234.56") == 1234.56

    def test_zero(self):
        assert parse_amount("0.00") == 0.0

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            parse_amount("")

    def test_whitespace_raises(self):
        with pytest.raises(ValueError):
            parse_amount("   ")


class TestParseSplitAmount:
    def test_debit_only_negative(self):
        assert parse_split_amount("42.99", "") == -42.99

    def test_credit_only_positive(self):
        assert parse_split_amount("", "42.99") == 42.99

    def test_both_present_net(self):
        assert parse_split_amount("10.00", "50.00") == 40.00

    def test_both_empty_raises(self):
        with pytest.raises(ValueError):
            parse_split_amount("", "")

    def test_debit_zero_treated_empty(self):
        assert parse_split_amount("0.00", "25.00") == 25.00

    def test_debit_with_dollar_sign(self):
        assert parse_split_amount("$1,234.56", "") == -1234.56

    def test_credit_comma_thousands(self):
        assert parse_split_amount("", "2,500.00") == 2500.00


class TestToCents:
    def test_positive_standard(self):
        assert to_cents(42.99) == 4299

    def test_negative_value(self):
        assert to_cents(-42.99) == -4299

    def test_zero(self):
        assert to_cents(0.0) == 0

    def test_whole_dollar(self):
        assert to_cents(100.00) == 10000

    def test_large_amount(self):
        assert to_cents(1234.56) == 123456

    def test_round_half_up_pos(self):
        assert to_cents(0.005) == 1

    def test_round_half_up_neg(self):
        assert to_cents(-0.005) == -1

    def test_floating_point_repr(self):
        # 0.1 + 0.2 in IEEE-754 = 0.30000000000000004; str() anchors to "0.30000000000000004"
        # Decimal("0.30000000000000004") * 100 rounds to 30
        val = 0.1 + 0.2
        assert to_cents(val) == 30

    def test_split_then_cents(self):
        amount = parse_split_amount("19.99", "")
        assert to_cents(amount) == -1999

    def test_credit_split_to_cents(self):
        amount = parse_split_amount("", "$1,234.56")
        assert to_cents(amount) == 123456
